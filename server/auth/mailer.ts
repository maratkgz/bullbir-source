// Outgoing auth emails. Production: Resend. Emulator: printed to the dev-server terminal
// (never to the structured log, which must stay free of codes). Tests capture messages.
import { getEnv } from '../env.js'
import { AppError } from '../errors.js'
import { log } from '../log.js'

export type AuthMail =
  | { kind: 'verify-code'; to: string; code: string }
  | { kind: 'login-code'; to: string; code: string; device: string; at: string }
  | { kind: 'already-registered'; to: string }
  | { kind: 'provider-linked'; to: string; provider: string; device: string; at: string }

export interface Mailer {
  send(mail: AuthMail): Promise<void>
}

const CODE_TTL_MINUTES = 10

function render(mail: AuthMail): { subject: string; text: string } {
  switch (mail.kind) {
    case 'verify-code':
      return {
        subject: `BullBir: ${mail.code}`,
        text: `Your BullBir confirmation code: ${mail.code}\nIt expires in ${CODE_TTL_MINUTES} minutes.\n\n`
          + `Ваш код подтверждения BullBir: ${mail.code}\nДействует ${CODE_TTL_MINUTES} минут.\n\n`
          + 'If you did not request it, ignore this email. / Если вы его не запрашивали — просто проигнорируйте письмо.',
      }
    case 'login-code':
      // No code in the subject (lock-screen previews); request context helps spot phishing.
      return {
        subject: 'BullBir: your sign-in code',
        text: `Your BullBir sign-in code: ${mail.code}\n`
          + `It expires in ${CODE_TTL_MINUTES} minutes and works only in the browser that asked for it.\n`
          + `Requested from: ${mail.device}, ${mail.at} (UTC).\n\n`
          + `Ваш код для входа в BullBir: ${mail.code}\n`
          + `Действует ${CODE_TTL_MINUTES} минут и только в том браузере, где его запросили.\n`
          + `Запрос: ${mail.device}, ${mail.at} (UTC).\n\n`
          + 'BullBir staff will never ask you for this code. If you did not try to sign in, ignore this email — your account is safe.\n'
          + 'Сотрудники BullBir никогда не попросят этот код. Если вы не пытались войти — проигнорируйте письмо, аккаунт в безопасности.',
      }
    case 'provider-linked':
      return {
        subject: `BullBir: ${mail.provider} sign-in was added`,
        text: `${mail.provider} sign-in was added to your BullBir account (${mail.device}, ${mail.at} UTC).\n`
          + 'If this was not you, sign in with your password or an email code and sign out everywhere.\n\n'
          + `К вашему аккаунту BullBir добавлен вход через ${mail.provider} (${mail.device}, ${mail.at} UTC).\n`
          + 'Если это были не вы — войдите паролем или кодом из почты и нажмите «Выйти везде».',
      }
    case 'already-registered':
      return {
        subject: 'BullBir: you already have an account',
        text: 'Someone tried to create a BullBir account with this email, but it already has one. '
          + 'Just sign in. If it was not you, nothing has changed.\n\n'
          + 'Кто-то попытался зарегистрироваться в BullBir с этой почтой, но аккаунт уже есть. '
          + 'Просто войдите. Если это были не вы — ничего не изменилось.',
      }
  }
}

class ConsoleMailer implements Mailer {
  async send(mail: AuthMail): Promise<void> {
    const { subject, text } = render(mail)
    // Dev only (emulator mode): the code must be readable by the developer.
    process.stdout.write(`\n[dev-mail] to=${mail.to}\n[dev-mail] ${subject}\n${text}\n\n`)
  }
}

class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(mail: AuthMail): Promise<void> {
    const { Resend } = await import('resend')
    const { subject, text } = render(mail)
    try {
      const { error } = await new Resend(this.apiKey).emails.send({ from: this.from, to: mail.to, subject, text })
      if (error) throw new Error(`resend ${error.name}`)
    } catch (err) {
      log.error('mail send failed', { kind: mail.kind, err })
      throw new AppError('service_unavailable', 'Mail service unavailable', { retryAfter: 60 })
    }
  }
}

let override: Mailer | undefined

export function setMailerForTests(mailer: Mailer | undefined): void {
  override = mailer
}

export function mailer(): Mailer {
  if (override) return override
  const env = getEnv()
  return env.mode === 'emulator' ? new ConsoleMailer() : new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
}
