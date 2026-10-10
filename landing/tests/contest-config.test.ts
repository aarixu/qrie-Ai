import { describe, expect, it } from 'vitest'
import { entriesOpenFrom, problemForCode } from '../lib/contest-config'

/**
 * WHAT THE CONTEST FORM SAYS ABOUT QRIE CONTROL'S CONTEST SWITCHES. Written
 * first.
 *
 * The page asks public.app_config whether entries are open before it shows
 * the form, and a failed or odd answer is never read as "open". The database
 * refuses a closed or full contest whatever the page shows (migration 0062);
 * each of its refusals is said in plain words.
 */

describe('the contest form and Qrie control', () => {
  it('entries are open only when the switch says true', () => {
    expect(entriesOpenFrom({ 'contest.entries_open': true })).toBe('open')
    expect(entriesOpenFrom({ 'contest.entries_open': false })).toBe('closed')
    expect(entriesOpenFrom({})).toBe('unknown')
    expect(entriesOpenFrom(null)).toBe('unknown')
    expect(entriesOpenFrom('x')).toBe('unknown')
    expect(entriesOpenFrom({ 'contest.entries_open': 'true' })).toBe('unknown')
  })

  it('each refusal the database can give has its sentence', () => {
    expect(problemForCode('53400')).toBe(
      'Entries are full for today. Please come back after midnight (India time); nothing was saved.'
    )
    expect(problemForCode('55000')).toBe('Entries are closed right now. Nothing was saved.')
    expect(problemForCode('08006')).toBe('We could not save that. Please try again in a moment.')
    expect(problemForCode(undefined)).toBe('We could not save that. Please try again in a moment.')
  })
})
