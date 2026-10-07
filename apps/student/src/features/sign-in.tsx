import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { api, backend, say } from '@/lib/backend'
import { forThisApp, NOT_A_STUDENT, useAuthStore } from '@/stores/auth-store'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/assets/logo'
import { useSignInSchool } from '@/lib/brand'

export function SignIn() {
  const navigate = useNavigate()
  const setMe = useAuthStore((s) => s.setMe)
  const [loginId, setLoginId] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const school = useSignInSchool(loginId)

  const idOk = /^[A-Za-z0-9-]{3,40}$/.test(loginId.trim())
  const pinOk = /^\d{6,8}$/.test(pin)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!idOk || !pinOk) {
      setProblem(!idOk ? 'Type the ID on your slip, like DEMO-8A-1.' : 'Your PIN is the 6 or 8 digits on your slip.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await backend.signIn(loginId.trim().toUpperCase(), pin)
      const me = await api.me()
      if (!forThisApp(me)) {
        await backend.signOut()
        setProblem(NOT_A_STUDENT)
        return
      }
      setMe(me)
      navigate({ to: '/', replace: true })
    } catch (err) {
      setProblem(say(err))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-10'>
      {school?.logo ? (
        <img
          src={`data:${school.logo.mime};base64,${school.logo.base64}`}
          alt=''
          className='mb-4 size-16 rounded-2xl bg-white object-contain p-1 shadow-sm'
        />
      ) : (
        <Logo className='mb-4 size-14' />
      )}
      <h1 className='mb-1 text-3xl font-bold tracking-tight'>{school?.schoolName ?? 'Qrie'}</h1>
      <p className='mb-8 text-muted-foreground'>Sign in with the ID and PIN your school gave you.</p>
      <form onSubmit={submit} className='space-y-4' noValidate>
        {problem && (
          <Alert variant='destructive'>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <div className='space-y-1.5'>
          <Label htmlFor='id'>Your ID</Label>
          <Input
            id='id'
            className='h-12 text-lg uppercase'
            autoComplete='username'
            autoCapitalize='characters'
            placeholder='DEMO-8A-1'
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='pin'>PIN</Label>
          <Input
            id='pin'
            className='h-12 text-lg tracking-[0.5em]'
            type='password'
            inputMode='numeric'
            autoComplete='current-password'
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <Button type='submit' className='h-12 w-full text-base' disabled={busy}>
          {busy && <Loader2 className='animate-spin' />}
          Sign in
        </Button>
        <p className='text-center text-sm text-muted-foreground'>
          Lost your slip? Ask your class teacher.
        </p>
      </form>
    </div>
  )
}
