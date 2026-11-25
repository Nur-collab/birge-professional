import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import '../i18n';
import Login from './Login';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({
  api: {
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

describe('Login accessibility', () => {
  test('associates the phone label and exposes a page heading', () => {
    render(<Login onLoggedIn={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в BIRGE' })).toBeInTheDocument();
    expect(screen.getByLabelText('Номер телефона')).toHaveAttribute('id', 'login-phone');
  });
});

describe('Login verification step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.sendCode.mockResolvedValue({ message: 'Запрос на отправку кода принят' });
  });

  test('shows a neutral delivery hint instead of the response channel', async () => {
    render(<Login onLoggedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Номер телефона'), {
      target: { value: '555123456' },
    });
    const submit = screen.getByRole('button', { name: /Получить код/ });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Подтверждение',
    })).toBeInTheDocument();
    expect(api.sendCode).toHaveBeenCalledWith('+996555123456');
    expect(screen.queryByText(/Код отправлен в Telegram/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tg_linked/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Если номер доступен, код придёт/)).toBeInTheDocument();
  });
});
