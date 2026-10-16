-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('FACILITATOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('SINGLE', 'TIED');

-- CreateEnum
CREATE TYPE "ProfileCode" AS ENUM ('DI', 'DS', 'DC', 'ID', 'IS', 'IC', 'SD', 'SI', 'SC', 'CD', 'CI', 'CS');

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "assessmentVersion" TEXT NOT NULL,
    "scoringPolicyVersion" TEXT NOT NULL,
    "profileTextPolicyVersion" TEXT NOT NULL,
    "inviteTokenHash" CHAR(64) NOT NULL,
    "inviteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "participantId" UUID NOT NULL,
    "groupId" TEXT NOT NULL,
    "rankedWordIds" TEXT[],
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("participantId","groupId")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "scoreD" INTEGER NOT NULL,
    "scoreI" INTEGER NOT NULL,
    "scoreS" INTEGER NOT NULL,
    "scoreC" INTEGER NOT NULL,
    "scoreRanking" JSONB NOT NULL,
    "tiedScoreGroups" JSONB NOT NULL,
    "profileStatus" "ProfileStatus" NOT NULL,
    "profileCode" "ProfileCode",
    "candidateProfileCodes" "ProfileCode"[],
    "candidateProfiles" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "assessmentVersion" TEXT NOT NULL,
    "scoringPolicyVersion" TEXT NOT NULL,
    "profileTextPolicyVersion" TEXT NOT NULL,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" CHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_inviteTokenHash_key" ON "Participant"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Result_participantId_key" ON "Result"("participantId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only invariants complement the Prisma schema and the Phase 4 service locks.
ALTER TABLE "Answer" ALTER COLUMN "rankedWordIds" SET NOT NULL;
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_four_words" CHECK (cardinality("rankedWordIds") = 4);
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_status_dates" CHECK (
  (status = 'INVITED' AND "startedAt" IS NULL AND "completedAt" IS NULL) OR
  (status = 'IN_PROGRESS' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL) OR
  (status = 'COMPLETED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
);
ALTER TABLE "Result" ALTER COLUMN "candidateProfileCodes" SET NOT NULL;
ALTER TABLE "Result" ADD CONSTRAINT "Result_score_bounds" CHECK (
  "scoreD" BETWEEN 14 AND 56 AND "scoreI" BETWEEN 14 AND 56 AND
  "scoreS" BETWEEN 14 AND 56 AND "scoreC" BETWEEN 14 AND 56 AND
  "scoreD" + "scoreI" + "scoreS" + "scoreC" = 140
);
ALTER TABLE "Result" ADD CONSTRAINT "Result_profile_shape" CHECK (
  (("profileStatus" = 'SINGLE' AND "profileCode" IS NOT NULL AND
    cardinality("candidateProfileCodes") = 1 AND "candidateProfileCodes"[1] = "profileCode") OR
   ("profileStatus" = 'TIED' AND "profileCode" IS NULL AND cardinality("candidateProfileCodes") BETWEEN 2 AND 12))
  AND jsonb_typeof("scoreRanking") = 'array'
  AND jsonb_typeof("tiedScoreGroups") = 'array'
  AND jsonb_typeof("candidateProfiles") = 'array'
  AND jsonb_array_length("candidateProfiles") = cardinality("candidateProfileCodes")
);
ALTER TABLE "Session" ADD CONSTRAINT "Session_one_principal" CHECK ((
  jsonb_typeof(data) = 'object' AND jsonb_typeof(data->'cookie') = 'object' AND
  jsonb_typeof(data->'principal') = 'object' AND (
    (data->'principal'->>'type' = 'STAFF' AND jsonb_typeof(data->'principal'->'staffUserId') = 'string'
      AND ((data->'principal') - 'type' - 'staffUserId') = '{}'::jsonb) OR
    (data->'principal'->>'type' = 'PARTICIPANT' AND jsonb_typeof(data->'principal'->'participantId') = 'string'
      AND ((data->'principal') - 'type' - 'participantId') = '{}'::jsonb)
  ) AND (data - 'cookie' - 'principal') = '{}'::jsonb
) IS TRUE);

CREATE FUNCTION reject_result_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Completed results are immutable';
END;
$$;
CREATE TRIGGER "Result_immutable" BEFORE UPDATE OR DELETE ON "Result"
  FOR EACH ROW EXECUTE FUNCTION reject_result_change();

-- Deferred checks permit atomic result insertion + COMPLETED update in either order.
-- SINGLE and TIED follow exactly the same completion invariant.
CREATE FUNCTION check_completed_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  participant_id uuid;
  p "Participant"%ROWTYPE;
  r "Result"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'Result' THEN participant_id := NEW."participantId";
  ELSE participant_id := NEW.id; END IF;
  SELECT * INTO p FROM "Participant" WHERE id = participant_id;
  SELECT * INTO r FROM "Result" WHERE "participantId" = participant_id;
  IF (p.status = 'COMPLETED') IS DISTINCT FROM (r.id IS NOT NULL) THEN
    RAISE EXCEPTION 'COMPLETED participants require exactly one stored result';
  END IF;
  IF r.id IS NOT NULL AND (
    p."completedAt" IS DISTINCT FROM r."completedAt" OR
    p."assessmentVersion" IS DISTINCT FROM r."assessmentVersion" OR
    p."scoringPolicyVersion" IS DISTINCT FROM r."scoringPolicyVersion" OR
    p."profileTextPolicyVersion" IS DISTINCT FROM r."profileTextPolicyVersion"
  ) THEN RAISE EXCEPTION 'Result versions and completion time must match the participant'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "Participant_completion" AFTER INSERT OR UPDATE ON "Participant"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_completed_result();
CREATE CONSTRAINT TRIGGER "Result_completion" AFTER INSERT ON "Result"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_completed_result();
