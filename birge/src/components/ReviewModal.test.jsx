import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import '../i18n';
import ReviewModal from './ReviewModal';

describe('ReviewModal accessibility', () => {
  test('is a labelled modal and closes on Escape', () => {
    const onSkip = vi.fn();
    render(<ReviewModal partner={{ id: 1, name: 'Айбек' }} onSubmit={vi.fn()} onSkip={onSkip} />);

    const dialog = screen.getByRole('dialog', { name: 'Оцените поездку' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Пропустить' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalled();
  });
});
