// Same rules as the Register form. Server rule (docs/auth-api.md): 10–128 characters.
export const PW_MIN = 10
export const PW_MAX = 128

/**
 * @param {string} password
 * @param {string} confirm
 * @returns {{ length: boolean, upper: boolean, number: boolean, match: boolean }}
 */
export function checkNewPassword(password, confirm) {
  return {
    length: password.length >= PW_MIN && password.length <= PW_MAX,
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
    match: password.length > 0 && password === confirm,
  }
}

/** @param {ReturnType<typeof checkNewPassword>} checks */
export const isNewPasswordValid = (checks) =>
  checks.length && checks.upper && checks.number && checks.match
