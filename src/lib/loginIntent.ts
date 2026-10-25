// Which door a person came in by, carried across the Google redirect. The tab only decides
// where the sign-in is allowed to land. It never grants a role: the role is read from
// public.users, which only the service role can elevate.

export type LoginIntent = 'nonprofit' | 'diplomat';

/** The only email domain that may sign in through the Data Diplomats door. */
export const TEAM_EMAIL_DOMAIN = 'datadiplomats.org';

const INTENT_KEY = 'dssg_login_intent';
const NOTICE_KEY = 'dssg_login_notice';

export function writeLoginIntent(intent: LoginIntent): void {
  try {
    sessionStorage.setItem(INTENT_KEY, intent);
  } catch {
    // Storage blocked: the redirect still works, the tab check just falls back to nonprofit.
  }
}

export function readLoginIntent(): LoginIntent | null {
  try {
    const value = sessionStorage.getItem(INTENT_KEY);
    return value === 'nonprofit' || value === 'diplomat' ? value : null;
  } catch {
    return null;
  }
}

export function clearLoginIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // ignore
  }
}

/** A message to show on the login page after a sign-in was refused. Read once. */
export function setLoginNotice(message: string): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, message);
  } catch {
    // ignore
  }
}

export function takeLoginNotice(): string | null {
  try {
    const message = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return message;
  } catch {
    return null;
  }
}

export interface SignInVerdict {
  allowed: boolean;
  notice?: string;
}

/**
 * Whether a freshly signed-in account may stay. The Data Diplomats door admits only team
 * accounts, i.e. profiles whose role is admin. Nonprofit sign-ins are admitted with any
 * role, since a new partner gets the client role from the provisioning trigger.
 */
export function admitSignIn(
  intent: LoginIntent | null,
  role: 'client' | 'admin' | null,
  email: string | null,
): SignInVerdict {
  if (intent !== 'diplomat') return { allowed: true };

  // The team door takes only the team's own email domain, whatever the role.
  const domain = email?.trim().toLowerCase().split('@')[1];
  if (domain !== TEAM_EMAIL_DOMAIN) {
    return {
      allowed: false,
      notice: `Data Diplomats sign-in needs a @${TEAM_EMAIL_DOMAIN} email. Use For Nonprofits for any other account.`,
    };
  }
  if (role !== 'admin') {
    return {
      allowed: false,
      notice:
        'That Google account is not a Data Diplomats team account. Use For Nonprofits, or ask DSSG to add your account.',
    };
  }
  return { allowed: true };
}
