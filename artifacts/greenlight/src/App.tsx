import { type ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { dark } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Welcome from '@/pages/welcome';
import Start from '@/pages/start';
import Results from '@/pages/results';
import Fix from '@/pages/fix';
import Replay from '@/pages/replay';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#007A99',
    colorForeground: '#F7FBFF',
    colorMutedForeground: '#CFE3EE',
    colorDanger: '#FF5C6E',
    colorBackground: '#0B1F2A',
    colorInput: '#06131A',
    colorInputForeground: '#F7FBFF',
    colorNeutral: '#7CC9E8',
    fontFamily: "'Inter', sans-serif",
    borderRadius: '12px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'w-[420px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { fontFamily: "'Space Grotesk', sans-serif", color: '#F7FBFF' },
    headerSubtitle: { color: '#CFE3EE' },
    socialButtonsBlockButtonText: { color: '#F7FBFF' },
    formFieldLabel: { color: '#CFE3EE', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '.1em', fontSize: 11 },
    footerActionLink: { color: '#00E5FF' },
    footerActionText: { color: '#CFE3EE' },
    dividerText: { color: '#CFE3EE' },
    identityPreviewEditButton: { color: '#00E5FF' },
    formFieldSuccessText: { color: '#4FD99A' },
    alertText: { color: '#F7FBFF' },
    formButtonPrimary: { background: '#007A99', color: '#fff', borderRadius: 12 },
    formFieldInput: { borderColor: 'rgba(124,201,232,.3)' },
    socialButtonsBlockButton: { borderColor: 'rgba(124,201,232,.3)' },
    dividerLine: { background: 'rgba(124,201,232,.3)' },
  },
};

function CacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    return addListener(({ user }) => {
      const uid = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== uid) qc.clear();
      prev.current = uid;
    });
  }, [addListener, qc]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Providers() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Sign in to Greenlight', subtitle: 'Your code and projects stay private to you' } },
        signUp: { start: { title: 'Create your account', subtitle: 'Needed to assess and fix your own code' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <CacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Welcome} />
              <Route path="/start">{() => <Start />}</Route>
              <Route path="/sign-in/*?">{() => <Start auth="in" />}</Route>
              <Route path="/sign-up/*?">{() => <Start auth="up" />}</Route>
              <Route path="/results/:id" component={Results} />
              <Route path="/fix/:id" component={Fix} />
              <Route path="/replay/:name" component={Replay} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <Providers />
    </WouterRouter>
  );
}

export default App;
