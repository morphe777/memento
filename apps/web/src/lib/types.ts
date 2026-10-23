// API payload types derived from the domain services (type-only import: nothing from the domain is bundled).
import type * as D from '@memento/domain';

export type Domain = ReturnType<typeof D.listDomains>[number];
export type Group = ReturnType<typeof D.listGroups>[number];
export type Project = ReturnType<typeof D.getProject>;
export type ProjectDetail = Project & {
  dependsOn: string[];
  resources: Resource[];
  readiness: ReturnType<typeof D.getProjectReadiness>;
};
export type Task = ReturnType<typeof D.getTask>;
export type TaskDetail = Task & { resources: Resource[] };
export type Objective = ReturnType<typeof D.getObjective>;
export type MetaObjective = ReturnType<typeof D.getMetaObjective>;
export type PathProject = ReturnType<typeof D.getObjectivePath>[number];
export type Resource = ReturnType<typeof D.listResources>[number];
export type PlanningPage = ReturnType<typeof D.getPlanningPage>;
export type PageTask = PlanningPage['groups'][number]['cards'][number]['tasks'][number];
export type Execution = ReturnType<typeof D.getExecution>;
export type ReportRow = ReturnType<typeof D.listReports>[number];
export type Report = ReturnType<typeof D.getReport>;
export type WeekPayload = ReturnType<typeof D.buildWeekPayload>;
export type Change = ReturnType<typeof D.listChanges>[number];
export type SearchResult = ReturnType<typeof D.search>;
export type Settings = D.Settings;
export interface Me {
  kind: 'user' | 'token';
  actor: string;
  login: string | null;
  canWrite: boolean;
  today: string;
  currentWeek: string;
  unreviewed: number;
}
export type BoardTask = ReturnType<typeof D.listBoardTasks>[number];
export type ObjectivesMap = ReturnType<typeof D.getObjectivesMap>;
export type MonthPlanningPage = ReturnType<typeof D.getMonthPlanningPage>;
export type InboxPage = ReturnType<typeof D.listInbox>;
export type QuarterPlanningPage = ReturnType<typeof D.getQuarterPlanningPage>;
