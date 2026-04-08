// Client-side barrel — re-exports only, NO 'use client' directive here.
// Individual component files get "use client" prepended by tsup onSuccess.
// This pattern is required for Next.js 16 Turbopack compatibility.
export { SpellCheckField } from './components/SpellCheckField.js'
export { SpellCheckDashboard } from './components/SpellCheckDashboard.js'
export { IssueCard } from './components/IssueCard.js'
export { SpellCheckScoreCell } from './components/SpellCheckScoreCell.js'
