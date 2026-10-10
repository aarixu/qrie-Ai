import { useState } from 'react'
import { backend } from '../lib/backend'
import { inPhoneApp, saveServer, savedServer, SERVER_ADDRESS } from '../lib/server'
import { Button } from './ui/button'
import { Input } from './ui/input'

/**
 * On the phone app's sign-in screen: the school server's address, and a way
 * to set another (lib/server.ts) — say, when the laptop running the demo is
 * on a new Wi-Fi address — without a new build. Nothing on the web, and
 * nothing in a build for the hosted project, whose address is built in.
 */
export function ServerSetting({ current, onSaved = () => location.reload() }: { current: string; onSaved?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current)
  const [problem, setProblem] = useState<string | null>(null)
  if (backend.mode !== 'demo') return null
  if (!inPhoneApp() && savedServer() === null) return null

  const save = () => {
    const address = value.trim().replace(/\/+$/, '')
    if (!SERVER_ADDRESS.test(address)) {
      setProblem(`Write the address like ${current}`)
      return
    }
    saveServer(address)
    onSaved()
  }

  return (
    <div className='mt-6 space-y-2 text-xs text-muted-foreground'>
      <p>
        School server: <span className='font-mono'>{current}</span>{' '}
        {!editing && (
          <Button variant='link' size='sm' className='h-auto p-0 text-xs' onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </p>
      {editing && (
        <div className='space-y-2'>
          <Input value={value} inputMode='url' aria-label='School server address' onChange={(e) => setValue(e.target.value)} />
          {problem && <p className='text-destructive'>{problem}</p>}
          <div className='flex flex-wrap gap-2'>
            <Button size='sm' onClick={save}>
              Save
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                saveServer(null)
                onSaved()
              }}
            >
              Use the built-in address
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
