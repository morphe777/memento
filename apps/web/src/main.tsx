import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AppShell } from './components/shell.tsx';
import { Loading } from './components/ui.tsx';
import { ApiError } from './lib/api.ts';
import { useMe, useSettings } from './lib/hooks.ts';
import { ConfigPage, LoginPage, ReviewPage } from './pages/admin.tsx';
import { DomainPage, DomainsPage, ObjectivePage, ObjectivesPage } from './pages/objectives.tsx';
import { PlanPage } from './pages/plan.tsx';
import { IdeasPage, InboxPage, ProjectPage, ProjectsPage } from './pages/projects.tsx';
import { ReportPage, ReportsPage } from './pages/reports.tsx';
import { WeekPage } from './pages/week.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});
window.addEventListener('memento:unauthenticated', () => queryClient.setQueryData(['me'], null));

function Root() {
  const me = useMe();
  const settings = useSettings();
  useEffect(() => {
    const c = settings.data?.['experience.badge_color'];
    if (c) document.documentElement.style.setProperty('--experience', c);
  }, [settings.data]);
  if (me.isLoading) return <Loading />;
  if (!me.data) return <LoginPage />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const rootRoute = createRootRoute({ component: Root });
const route = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const indexRoute = route('/', () => <Navigate to="/semaine" />);
const weekRoute = route('/semaine', WeekPage);
const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planifier',
  validateSearch: (s: Record<string, unknown>): { semaine?: string } => ({ semaine: str(s.semaine) }),
  component: function Plan() {
    const { semaine } = planRoute.useSearch();
    return <PlanPage semaine={semaine} />;
  },
});
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  validateSearch: (s: Record<string, unknown>): { tache?: string } => ({ tache: str(s.tache) }),
  component: function Inbox() {
    return <InboxPage tache={inboxRoute.useSearch().tache} />;
  },
});
const objectivesRoute = route('/objectifs', ObjectivesPage);
const objectiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/objectifs/$id',
  component: function Objective() {
    return <ObjectivePage id={objectiveRoute.useParams().id} />;
  },
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projets',
  validateSearch: (s: Record<string, unknown>): { groupe?: string; vue?: 'tree' | 'list' | 'kanban' } => ({
    groupe: str(s.groupe),
    vue: ['tree', 'list', 'kanban'].includes(String(s.vue))
      ? (s.vue as 'tree' | 'list' | 'kanban')
      : undefined,
  }),
  component: function Projects() {
    const { groupe, vue } = projectsRoute.useSearch();
    return <ProjectsPage groupe={groupe} vue={vue} />;
  },
});
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projets/$id',
  validateSearch: (s: Record<string, unknown>): { tache?: string } => ({ tache: str(s.tache) }),
  component: function Project() {
    return <ProjectPage id={projectRoute.useParams().id} tache={projectRoute.useSearch().tache} />;
  },
});
const domainsRoute = route('/domaines', DomainsPage);
const domainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domaines/$id',
  component: function Domain() {
    return <DomainPage id={domainRoute.useParams().id} />;
  },
});
const ideasRoute = route('/idees', IdeasPage);
const reportsRoute = route('/rapports', ReportsPage);
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rapports/$id',
  component: function Report() {
    return <ReportPage id={reportRoute.useParams().id} />;
  },
});
const reviewRoute = route('/a-revoir', ReviewPage);
const configIndexRoute = route('/configuration', () => (
  <Navigate to="/configuration/$onglet" params={{ onglet: 'budget' }} />
));
const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/configuration/$onglet',
  component: function Config() {
    return <ConfigPage onglet={configRoute.useParams().onglet} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  weekRoute,
  planRoute,
  inboxRoute,
  objectivesRoute,
  objectiveRoute,
  projectsRoute,
  projectRoute,
  domainsRoute,
  domainRoute,
  ideasRoute,
  reportsRoute,
  reportRoute,
  reviewRoute,
  configIndexRoute,
  configRoute,
]);

const router = createRouter({ routeTree, defaultPreload: 'intent' });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
