import { useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { backend } from '@/lib/backend'
import { useSignInSchool } from '@/lib/brand'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const [loginId, setLoginId] = useState('')
  const school = useSignInSchool(loginId)

  return (
    <AuthLayout school={school}>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>
            Sign in to Qrie for teachers
          </CardTitle>
          <CardDescription>
            Use the school ID and PIN on the slip your school gave you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirect} onLoginIdChange={setLoginId} />
        </CardContent>
        <CardFooter>
          <p className='text-center text-sm text-muted-foreground'>
            {backend.mode === 'demo'
              ? 'Demo school: the IDs and PINs are in tools/lms-demo/.demo-data/logins.md.'
              : 'Forgotten your PIN? Your school office can give you a new one.'}
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
