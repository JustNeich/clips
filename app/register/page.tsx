"use client";

import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Регистрация закрыта</h1>
        <p className="subtle-text">
          Аккаунт создаётся только по приглашению от владельца или администратора команды.
        </p>
        <div className="auth-links">
          <Link href="/accept-invite">Принять приглашение</Link>
          <Link href="/login">Назад ко входу</Link>
        </div>
      </section>
    </main>
  );
}
