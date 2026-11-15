import type { ProjectDto } from '../../contracts/core';

/** Use persisted workflow evidence, never infer a project's editor from its display name. */
export function projectDestination(project: Pick<ProjectDto, 'id' | 'workflow'>): string {
  return `${project.workflow === 'detail-page' ? '/detail-pages' : '/workbench'}/${project.id}`;
}
