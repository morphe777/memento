import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AppShell } from './components/shell.tsx';
import { Loading } from './components/ui.tsx';
import { ApiError } from './lib/api.ts';
import { useMe } from './lib/hooks.ts';
import { ConfigPage, LoginPage, ReviewPage } from './pages/admin.tsx';
import { CalendarPageView, type CalendarView } from './pages/calendar.tsx';
import { CapPage } from './pages/cap.tsx';
import { ExperiencesPage, type ExperiencesTab } from './pages/experiences.tsx';
import { NotificationsPage } from './pages/notifications.tsx';
import {
  DomainPage,
  DomainsPage,
  MetaObjectivePage,
  ObjectivePage,
  ObjectivesPage,
} from './pages/objectives.tsx';
import { PlanPage } from './pages/plan.tsx';
import { IdeasPage, InboxPage, ProjectPage, ProjectsPage } from './pages/projects.tsx';
import { ReportPage, ReportsPage } from './pages/reports.tsx';
import { SouvenirPage, type SouvenirsView, SouvenirVerifyPage } from './pages/souvenirs.tsx';
import { TasksPage, type TaskView } from './pages/tasks.tsx';
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
const weekRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/semaine',
  validateSearch: (s: Record<string, unknown>): { semaine?: string } => ({ semaine: str(s.semaine) }),
  component: function Week() {
    const { semaine } = weekRoute.useSearch();
    return <WeekPage semaine={semaine} />;
  },
});
const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planifier',
  validateSearch: (
    s: Record<string, unknown>,
  ): { semaine?: string; vue?: 'mois' | 'trimestre'; mois?: string } => ({
    semaine: str(s.semaine),
    vue: s.vue === 'mois' || s.vue === 'trimestre' ? s.vue : undefined,
    mois: str(s.mois),
  }),
  component: function Plan() {
    const { semaine, vue, mois } = planRoute.useSearch();
    return <PlanPage semaine={semaine} vue={vue} mois={mois} />;
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
const capRoute = route('/cap', CapPage); // D-100
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendrier', // D-113
  validateSearch: (s: Record<string, unknown>): { vue?: CalendarView; date?: string } => ({
    vue: s.vue === 'semaine' || s.vue === 'trimestre' ? s.vue : undefined,
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
  }),
  component: function Calendar() {
    const { vue, date } = calendarRoute.useSearch();
    return <CalendarPageView vue={vue} date={date} />;
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
const metaObjectiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/meta-objectifs/$id',
  component: function MetaObjective() {
    return <MetaObjectivePage id={metaObjectiveRoute.useParams().id} />;
  },
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projets',
  validateSearch: (
    s: Record<string, unknown>,
  ): { groupe?: string; vue?: 'tree' | 'list' | 'kanban'; filtre?: string } => ({
    groupe: str(s.groupe),
    filtre: str(s.filtre),
    vue: ['tree', 'list', 'kanban'].includes(String(s.vue))
      ? (s.vue as 'tree' | 'list' | 'kanban')
      : undefined,
  }),
  component: function Projects() {
    const { groupe, vue, filtre } = projectsRoute.useSearch();
    return <ProjectsPage groupe={groupe} vue={vue} filtre={filtre} />;
  },
});
const taskView = (v: unknown): TaskView | undefined => (v === 'table' || v === 'kanban' ? v : undefined);
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projets/$id',
  validateSearch: (s: Record<string, unknown>): { tache?: string; vue?: TaskView } => ({
    tache: str(s.tache),
    vue: taskView(s.vue),
  }),
  component: function Project() {
    const { tache, vue } = projectRoute.useSearch();
    return <ProjectPage id={projectRoute.useParams().id} tache={tache} vue={vue} />;
  },
});
const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/taches',
  validateSearch: (s: Record<string, unknown>): { tache?: string; vue?: TaskView } => ({
    tache: str(s.tache),
    vue: taskView(s.vue),
  }),
  component: function Tasks() {
    const { tache, vue } = tasksRoute.useSearch();
    return <TasksPage tache={tache} vue={vue} />;
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
const TABS: ExperiencesTab[] = ['vecues', 'a-vivre', 'bilan'];
const experiencesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiences',
  validateSearch: (
    s: Record<string, unknown>,
  ): { tache?: string; onglet?: ExperiencesTab; vue?: SouvenirsView } => ({
    tache: str(s.tache),
    onglet: TABS.includes(s.onglet as ExperiencesTab) ? (s.onglet as ExperiencesTab) : undefined,
    vue: s.vue === 'carte' ? 'carte' : undefined,
  }),
  component: function Experiences() {
    const { tache, onglet, vue } = experiencesRoute.useSearch();
    return <ExperiencesPage tache={tache} onglet={onglet} vue={vue} />;
  },
});
// D-170: souvenirs and envies are tabs of Expériences; the old addresses lead there.
const souvenirsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/souvenirs',
  validateSearch: (s: Record<string, unknown>): { vue?: SouvenirsView } => ({
    vue: s.vue === 'carte' ? 'carte' : undefined,
  }),
  component: function Souvenirs() {
    return <Navigate to="/experiences" search={{ onglet: 'vecues', vue: souvenirsRoute.useSearch().vue }} />;
  },
});
const souvenirRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/souvenirs/$id',
  component: function Souvenir() {
    return <SouvenirPage id={souvenirRoute.useParams().id} />;
  },
});
const souvenirVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/souvenirs/$id/verifier',
  component: function SouvenirVerify() {
    const id = souvenirVerifyRoute.useParams().id;
    return <SouvenirVerifyPage key={id} id={id} />;
  },
});
// D-170, D-171: the envies are the « À vivre » tab of Expériences (an old link to one envie leads there too).
const wishesRoute = route('/envies', () => <Navigate to="/experiences" search={{ onglet: 'a-vivre' }} />);
const wishRoute = route('/envies/$id', () => <Navigate to="/experiences" search={{ onglet: 'a-vivre' }} />);
const reportsRoute = route('/rapports', ReportsPage);
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rapports/$id',
  component: function Report() {
    return <ReportPage id={reportRoute.useParams().id} />;
  },
});
// D-117: notices sent (bell); the push opens one in full.
const notificationsRoute = route('/notifications', () => <NotificationsPage />);
const notificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications/$id',
  component: function Notification() {
    return <NotificationsPage id={notificationRoute.useParams().id} />;
  },
});
const reviewRoute = route('/journal', ReviewPage);
const oldReviewRoute = route('/a-revoir', () => <Navigate to="/journal" />);
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
  notificationsRoute,
  notificationRoute,
  weekRoute,
  capRoute,
  calendarRoute,
  planRoute,
  inboxRoute,
  objectivesRoute,
  objectiveRoute,
  metaObjectiveRoute,
  projectsRoute,
  projectRoute,
  tasksRoute,
  domainsRoute,
  domainRoute,
  ideasRoute,
  experiencesRoute,
  souvenirsRoute,
  souvenirRoute,
  souvenirVerifyRoute,
  wishesRoute,
  wishRoute,
  reportsRoute,
  reportRoute,
  reviewRoute,
  oldReviewRoute,
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
