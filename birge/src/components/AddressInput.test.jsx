import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import AddressInput from './AddressInput';

function Harness() {
  const [value, setValue] = useState('');
  return <AddressInput value={value} onChange={setValue} placeholder="Адрес" name="address" />;
}

describe('AddressInput accessibility', () => {
  test('selects a suggestion with ArrowDown and Enter', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Адрес' });

    fireEvent.change(input, { target: { value: 'Ала' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Жилмассив Ала-Арча');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('closes suggestions with Escape', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Адрес' });

    fireEvent.change(input, { target: { value: 'Ала' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
