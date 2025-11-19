import type {
  Project,
  ProjectUpdate,
} from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { CalendarDays, Target } from 'lucide-react';
import { useView, view, ViewRef } from 'react-fate';
import formatLabel from '../lib/formatLabel.tsx';
import { Badge } from './Badge.tsx';
import Card from './Card.tsx';
import { UserView } from './UserCard.tsx';

const ProjectUpdateView = view<ProjectUpdate>()({
  author: UserView,
  confidence: true,
  content: true,
  createdAt: true,
  id: true,
  mood: true,
});

const intlFormatDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string | null | undefined) =>
  value ? intlFormatDate.format(new Date(value)) : 'TBD';

const ProjectUpdateItem = ({
  update: updateRef,
}: {
  update: ViewRef<'ProjectUpdate'>;
}) => {
  const update = useView(ProjectUpdateView, updateRef);
  const author = useView(UserView, update.author);

  return (
    <VStack gap={4} key={update.id}>
      <Stack alignCenter between gap={12}>
        <span className="text-muted-foreground text-xs">
          {author?.name ?? 'Unknown'} · {formatDate(update.createdAt)}
        </span>
        <Stack alignCenter gap={8}>
          {update.mood ? (
            <Badge className="text-nowrap" variant="outline">
              <Stack gap={2}>
                <span>Mood:</span>
                <span>{update.mood}</span>
              </Stack>
            </Badge>
          ) : null}
          {update.confidence != null ? (
            <Badge className="text-nowrap" variant="outline">
              <Stack gap={2}>
                <span>Confidence:</span>
                <span>{update.confidence}/5</span>
              </Stack>
            </Badge>
          ) : null}
        </Stack>
      </Stack>
      <p className="text-foreground/90 text-sm leading-relaxed">
        {update.content}
      </p>
    </VStack>
  );
};

export const ProjectView = view<Project>()({
  focusAreas: true,
  id: true,
  metrics: true,
  name: true,
  owner: UserView,
  progress: true,
  startDate: true,
  status: true,
  summary: true,
  targetDate: true,
  updates: {
    items: {
      node: ProjectUpdateView,
    },
  },
});

export default function ProjectCard({
  project: projectRef,
}: {
  project: ViewRef<'Project'>;
}) {
  const project = useView(ProjectView, projectRef);
  const owner = useView(UserView, project.owner);
  const updates = project.updates?.items ?? [];
  const focusAreas = project.focusAreas ?? [];
  const metrics = project.metrics;
  const progress = Math.min(Math.max(project.progress ?? 0, 0), 100);

  return (
    <Card key={project.id}>
      <VStack gap={16}>
        <Stack alignCenter between gap={12}>
          <div>
            <h4 className="text-foreground text-base font-semibold">
              {project.name}
            </h4>
            <p className="text-muted-foreground text-sm">{project.summary}</p>
          </div>
          <Badge className="text-nowrap" variant="outline">
            {formatLabel(project.status)}
          </Badge>
        </Stack>
        <Stack gap={16} wrap>
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">Owner</span>
            <span className="text-foreground text-sm font-medium">
              {owner?.name ?? 'Unknown'}
            </span>
          </VStack>
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">Timeline</span>
            <Stack alignCenter gap={8}>
              <CalendarDays className="text-muted-foreground" size={14} />
              <span className="text-foreground/80 text-sm">
                {formatDate(project.startDate)} →{' '}
                {formatDate(project.targetDate)}
              </span>
            </Stack>
          </VStack>
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">Progress</span>
            <Stack alignCenter gap={8}>
              <Target className="text-muted-foreground" size={14} />
              <span className="text-foreground text-sm font-medium">
                {progress}%
              </span>
            </Stack>
          </VStack>
        </Stack>
        {focusAreas.length ? (
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">Focus Areas</span>
            <Stack gap={8} wrap>
              {focusAreas.map((area) => (
                <Badge key={area} variant="secondary">
                  {area}
                </Badge>
              ))}
            </Stack>
          </VStack>
        ) : null}
        {metrics ? (
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">
              Signals we track
            </span>
            <VStack gap>
              {Object.entries(metrics).map(([key, value]) => {
                let name = key.replaceAll(/([A-Z])/g, ' $1').trim();
                name = name.charAt(0).toUpperCase() + name.slice(1);
                return (
                  <Stack alignCenter between gap={12} key={key}>
                    <span className="text-xs">{name}</span>
                    <span className="text-foreground text-sm font-medium">
                      {String(value)}
                    </span>
                  </Stack>
                );
              })}
            </VStack>
          </VStack>
        ) : null}
        {updates.length ? (
          <VStack gap={12}>
            <span className="text-muted-foreground text-xs">
              Latest updates
            </span>
            <VStack gap={12}>
              {updates.map(({ node }) => (
                <ProjectUpdateItem key={node.id} update={node} />
              ))}
            </VStack>
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
