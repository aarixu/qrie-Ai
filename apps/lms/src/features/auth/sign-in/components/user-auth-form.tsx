import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { api, backend } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { NOT_A_TEACHER, useAuthStore } from '@/stores/auth-store'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

// The shapes lms.account (0022) and the import's PINs (6-8 digits) allow.
const formSchema = z.object({
  loginId: z
    .string()
    .trim()
    .min(1, 'Enter the ID on your sign-in slip.')
    .regex(/^[A-Za-z0-9-]{3,40}$/, 'An ID is letters, digits and dashes, like DEMO-T01.'),
  pin: z
    .string()
    .min(1, 'Enter your PIN.')
    .regex(/^\d{6,8}$/, 'A PIN is 6 to 8 digits.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
  /** Told the ID as it is typed, so the screen can show the school's look. */
  onLoginIdChange?: (loginId: string) => void
}

export function UserAuthForm({
  className,
  redirectTo,
  onLoginIdChange,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const navigate = useNavigate()
  const setMe = useAuthStore((s) => s.setMe)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { loginId: '', pin: '' },
  })
  const typed = form.watch('loginId')
  useEffect(() => onLoginIdChange?.(typed), [typed, onLoginIdChange])

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    setProblem(null)
    try {
      await backend.signIn(data.loginId.toUpperCase(), data.pin)
      const me = await api.me()
      if (!me || me.kind === 'student') {
        await backend.signOut()
        setProblem(NOT_A_TEACHER)
        return
      }
      setMe(me)
      navigate({ to: redirectTo || '/', replace: true })
    } catch (e) {
      setProblem(
        e instanceof TypeError
          ? 'Could not reach the school server. Is it running?'
          : (e as Error).message
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        {problem && (
          <Alert variant='destructive'>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name='loginId'
          render={({ field }) => (
            <FormItem>
              <FormLabel>School ID</FormLabel>
              <FormControl>
                <Input
                  placeholder='DEMO-T01'
                  autoComplete='username'
                  autoCapitalize='characters'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='pin'
          render={({ field }) => (
            <FormItem>
              <FormLabel>PIN</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  inputMode='numeric'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in
        </Button>
      </form>
    </Form>
  )
}
