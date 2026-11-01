// One-time repair: profile accounts created before humanized identities got
// label-derived handles/names/emails (e.g. label "gpt-4o-run1" → handle
// "gpt_4o_run1", name "gpt-4o-run1", email "gpt-4o-run1-3f2a@mrxclients.io").
// Those fields are observable by the model under test (/account, /auth/me)
// and by everyone on the leaderboard (handle) — they must never encode the
// operator label or model. This script regenerates a synthetic human identity
// for every affected TestProfile account. Safe to re-run: new-style accounts
// are left untouched.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const FIRST = ['Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Quinn', 'Hayden', 'Rowan', 'Emerson', 'Skylar', 'Marlowe', 'Devon', 'Blake', 'Reese', 'Parker', 'Sawyer', 'Finley', 'Cameron', 'Aubrey', 'Lennox']
const LAST = ['Avery', 'Brooks', 'Carter', 'Delaney', 'Ellison', 'Foster', 'Grant', 'Harrison', 'Ingram', 'Jennings', 'Keller', 'Lawson', 'Mercer', 'Novak', 'Ortiz', 'Palmer', 'Quintero', 'Reyes', 'Sullivan', 'Thornton']
const ADJ = ['quiet', 'amber', 'cobalt', 'velvet', 'north', 'harbor', 'lunar', 'ivory', 'cedar', 'rapid', 'sable', 'golden', 'silver', 'stellar', 'meadow', 'summit', 'winter', 'copper', 'drift', 'ember']
const NOUN = ['falcon', 'heron', 'otter', 'wolf', 'storm', 'ridge', 'compass', 'beacon', 'willow', 'sparrow', 'badger', 'ember', 'flint', 'gale', 'orchid', 'quarry', 'martin', 'pixel', 'cursor', 'delta']
const pick = (a) => a[Math.floor(Math.random() * a.length)]

function newIdentity() {
  const handle = `${pick(ADJ)}_${pick(NOUN)}_${Math.floor(Math.random() * 90) + 10}`
  return {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    handle,
    email: `${handle}_${Math.random().toString(16).slice(2, 8)}@mrxclients.io`,
  }
}

const profiles = await db.testProfile.findMany({ include: { account: true } })
console.log(`TestProfile rows: ${profiles.length}`)
let fixed = 0
for (const p of profiles) {
  const a = p.account
  const slugHandle = p.label.replace(/-/g, '_').slice(0, 18)
  const oldStyle =
    a.email.startsWith(p.label + '-') ||
    a.name === p.label ||
    a.handle === slugHandle ||
    a.handle.startsWith(slugHandle + '_')
  if (!oldStyle) {
    console.log(`  ok    ${p.label} → already humanized (${a.handle})`)
    continue
  }
  let ident = newIdentity()
  // handle is globally unique — retry until free
  for (let i = 0; i < 20; i++) {
    if (!(await db.account.findUnique({ where: { handle: ident.handle } }))) break
    ident = newIdentity()
  }
  await db.account.update({
    where: { id: a.id },
    data: { name: ident.name, handle: ident.handle, email: ident.email },
  })
  fixed++
  console.log(`  fixed ${p.label}: ${a.handle}/${a.email} → ${ident.handle}/${ident.email} (${ident.name})`)
}
console.log(`Done. ${fixed} account(s) re-identified.`)
await db.$disconnect()
