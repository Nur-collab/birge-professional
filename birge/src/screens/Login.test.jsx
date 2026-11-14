import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import '../i18n';
import Login from './Login';

describe('Login accessibility', () => {
  test('associates the phone label and exposes a page heading', () => {
    render(<Login onLoggedIn={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в BIRGE' })).toBeInTheDocument();
    expect(screen.getByLabelText('Номер телефона')).toHaveAttribute('id', 'login-phone');
  });
});
