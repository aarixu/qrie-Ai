import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { isSignedOutError } from '@/lib/backend'
import { applyBrand } from '@/lib/brand'
import { signOut } from '@/stores/auth-store'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A refusal from the database (not your class, not signed in) will not
      // change on a retry; a dropped connection might.
      retry: (failureCount, error) =>
        failureCount < 2 && error instanceof TypeError,
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000,
    },
    mutations: {
      onError: (error) => {
        if (!isSignedOutError(error)) toast.error(error.message)
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isSignedOutError(error)) {
        toast.error('Your session has ended. Please sign in again.')
        void signOut().then(() => {
          router.navigate({
            to: '/sign-in',
            search: { redirect: router.history.location.href },
          })
        })
      }
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  // Qrie's colours until somebody signs in and their school's take over.
  applyBrand(null)
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
