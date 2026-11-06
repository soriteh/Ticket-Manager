import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL

export const isNeonAuthConfigured = Boolean(authUrl)

export const authClient = createAuthClient(authUrl || 'http://localhost', {
  adapter: BetterAuthReactAdapter(),
})
