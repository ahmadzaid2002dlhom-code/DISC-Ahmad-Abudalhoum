'use client';

import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import type { VisibleWord } from '../lib/assessment-types';
import styles from './assessment.module.css';

function WordRow({ word, index, disabled, moving, onMove }: {
  word: VisibleWord; index: number; disabled: boolean; moving: boolean; onMove: (from: number, to: number) => void;
}) {
  const { ref, handleRef } = useSortable({ id: word.id, index, disabled });
  return <li ref={ref} className={styles.word}>
    <div className={styles.wordHeading}>
      <button ref={handleRef} className={styles.handle} type="button" disabled={disabled}
        aria-label={`Drag ${word.textEn} to reorder`} aria-describedby="reorder-help">↕</button>
      <div className={styles.wordText}>
        <strong>{index + 1}. {word.textEn}</strong>
        <span lang="ar" dir="rtl" className={styles.arabic}>{word.textAr}</span>
      </div>
    </div>
    <div className={styles.controls}>
      <button type="button" disabled={disabled || moving || index === 0} aria-label={`Move ${word.textEn} up`} onClick={() => onMove(index, index - 1)}>Move Up</button>
      <button type="button" disabled={disabled || moving || index === 3} aria-label={`Move ${word.textEn} down`} onClick={() => onMove(index, index + 1)}>Move Down</button>
    </div>
  </li>;
}

export default function RankedWords({ words, disabled, moving, onMove, onDragging }: {
  words: VisibleWord[]; disabled: boolean; moving: boolean;
  onMove: (from: number, to: number) => void; onDragging: (dragging: boolean) => void;
}) {
  return <DragDropProvider
    onDragStart={() => onDragging(true)}
    onDragEnd={event => {
      if (!event.canceled && isSortable(event.operation.source)) {
        const { initialIndex, index } = event.operation.source;
        if (initialIndex !== index) onMove(initialIndex, index);
      }
      onDragging(false);
    }}>
    <ol className={styles.list} aria-label="Words from most to least like you">
      {words.map((word, index) => <WordRow key={word.id} word={word} index={index} disabled={disabled} moving={moving} onMove={onMove} />)}
    </ol>
  </DragDropProvider>;
}
