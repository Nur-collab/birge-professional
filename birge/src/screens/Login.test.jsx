import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../i18n';
import Login from './Login';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({
  api: {
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    getCurrentUser: vi.fn(),
    createTelegramChallenge: vi.fn(),
    getTelegramChallengeStatus: vi.fn(),
    completeTelegramChallenge: vi.fn(),
  },
}));

describe('Login accessibility and prerequisite flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  test('associates the phone label, exposes page heading, and surfaces Telegram prerequisite', () => {
    render(<Login onLoggedIn={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в BIRGE' })).toBeInTheDocument();
    expect(screen.getByLabelText('Номер телефона')).toHaveAttribute('id', 'login-phone');
    expect(screen.getByRole('button', { name: /Войти через @BirgeAuthBot/ })).toBeInTheDocument();
    expect(screen.getByText('Важно перед получением кода')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Открыть @BirgeAuthBot/ })).toHaveAttribute(
      'href',
      'https://t.me/BirgeAuthBot',
    );
  });
});

describe('Login verification step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    api.sendCode.mockResolvedValue({ message: 'Запрос на отправку кода принят' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shows a neutral delivery hint instead of leaking channel binding', async () => {
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
    expect(
      screen.getByText(/Мы отправим 6-значный код в Telegram-бот @BirgeAuthBot/),
    ).toBeInTheDocument();
  });

  test('highlights rescue guidance after 8s and enables resend after 60s', async () => {
    vi.useFakeTimers();
    render(<Login onLoggedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Номер телефона'), {
      target: { value: '555123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Получить код/ }));
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Подтверждение' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Отправить код повторно через 60 сек/ })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByText('Код не приходит?')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(52000);
    });
    const resendBtn = screen.getByRole('button', { name: 'Отправить код повторно' });
    expect(resendBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(api.sendCode).toHaveBeenCalledTimes(2);
  });
});

describe('Telegram deep-link challenge flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  test('completes login automatically for verified returning user and asks name for new user', async () => {
    const onLoggedIn = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    api.createTelegramChallenge.mockResolvedValue({
      challenge_id: 'chal_1234567890abcdef',
      verifier: 'ver_1234567890abcdef123456',
      bot_username: 'BirgeAuthBot',
      telegram_url: 'https://t.me/BirgeAuthBot?start=auth_chal_1234567890abcdef',
      expires_in: 300,
    });
    api.getTelegramChallengeStatus.mockResolvedValue({
      status: 'verified',
      phone: '+996 555 123 456',
      is_new_user: true,
      expires_in: 280,
    });
    api.completeTelegramChallenge.mockResolvedValue({
      access_token: 'tok',
      user: { id: 7, name: 'Айбек', phone: '+996555123456', is_verified: true },
    });

    render(<Login onLoggedIn={onLoggedIn} />);
    fireEvent.click(screen.getByRole('button', { name: /Войти через @BirgeAuthBot/ }));

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Завершение входа',
    })).toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledWith(
      'https://t.me/BirgeAuthBot?start=auth_chal_1234567890abcdef',
      '_blank',
      'noopener,noreferrer',
    );

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Айбек' } });
    fireEvent.click(screen.getByRole('button', { name: /Завершить вход/ }));

    await waitFor(() => {
      expect(api.completeTelegramChallenge).toHaveBeenCalledWith(
        'chal_1234567890abcdef',
        'ver_1234567890abcdef123456',
        'Айбек',
      );
      expect(onLoggedIn).toHaveBeenCalledWith({
        id: 7,
        name: 'Айбек',
        phone: '+996555123456',
        is_verified: true,
      });
    });

    openSpy.mockRestore();
  });
});
