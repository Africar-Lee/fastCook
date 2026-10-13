import type { RequirementMatch } from '../../../packages/engine/src/types';
import type { AppRequirement } from './types';

type RequirementPresentation = Readonly<{ requirement: AppRequirement; match: RequirementMatch }>;

function requirementPriority(match: RequirementMatch): 0 | 1 | 2 | 3 | 4 {
  if (match.omitted) return 4;
  if (match.presence === 'missing') return 0;
  if (match.presence === 'uncertain') return 1;
  if (match.match_kind === 'substitution') return 2;
  return 3;
}

export function orderRequirements(
  requirements: readonly AppRequirement[],
  matches: readonly RequirementMatch[],
): readonly RequirementPresentation[] {
  const matchesById = new Map(matches.map(match => [match.requirement_id, match]));
  const groups: [RequirementPresentation[], RequirementPresentation[], RequirementPresentation[],
    RequirementPresentation[], RequirementPresentation[]] = [[], [], [], [], []];
  for (const requirement of requirements) {
    const match = matchesById.get(requirement.requirement_id);
    if (match) groups[requirementPriority(match)]!.push({ requirement, match });
  }
  return groups.flat();
}
