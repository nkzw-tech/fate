import type { Event, EventAttendee } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { ArrowUpRight, CalendarDays, MapPin, Users } from 'lucide-react';
import { useView, view, ViewRef } from 'react-fate';
import formatLabel from '../lib/formatLabel.tsx';
import { Badge } from '../ui/Badge.tsx';
import Card from '../ui/Card.tsx';
import { UserView } from '../ui/UserCard.tsx';

const EventAttendeeView = view<EventAttendee>()({
  id: true,
  notes: true,
  status: true,
  user: UserView,
});

export const EventView = view<Event>()({
  attendees: {
    items: {
      node: EventAttendeeView,
    },
  },
  attendingCount: true,
  capacity: true,
  description: true,
  endAt: true,
  host: UserView,
  id: true,
  livestreamUrl: true,
  location: true,
  name: true,
  resources: true,
  startAt: true,
  topics: true,
  type: true,
});

const EventAttendeeChip = ({
  attendee: attendeeRef,
}: {
  attendee: ViewRef<'EventAttendee'>;
}) => {
  const attendee = useView(EventAttendeeView, attendeeRef);
  const user = useView(UserView, attendee.user);

  return (
    <Badge key={attendee.id} variant="outline">
      {user?.name ?? 'Guest'} · {formatLabel(attendee.status)}
    </Badge>
  );
};

const intlFormatDateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  month: 'short',
});

const formatDateTime = (date: string) =>
  intlFormatDateTime.format(new Date(date));

export default function EventCard({
  event: eventRef,
}: {
  event: ViewRef<'Event'>;
}) {
  const event = useView(EventView, eventRef);
  const host = useView(UserView, event.host);
  const attendees = event.attendees?.items ?? [];
  const topics = event.topics ?? [];

  return (
    <Card key={event.id}>
      <VStack gap={12}>
        <Stack alignCenter between gap={12}>
          <div>
            <h4 className="text-foreground text-base font-semibold">
              {event.name}
            </h4>
            <p className="text-muted-foreground text-sm">{event.description}</p>
          </div>
          <Badge variant="secondary">{formatLabel(event.type)}</Badge>
        </Stack>
        <Stack alignCenter gap={8}>
          <CalendarDays className="text-muted-foreground" size={14} />
          <span className="text-foreground/80 text-sm">
            {formatDateTime(event.startAt)} → {formatDateTime(event.endAt)}
          </span>
        </Stack>
        <Stack alignCenter gap={8}>
          <MapPin className="text-muted-foreground" size={14} />
          <span className="text-foreground/80 text-sm">{event.location}</span>
        </Stack>
        <Stack alignCenter gap={8}>
          <Users className="text-muted-foreground" size={14} />
          <span className="text-foreground/80 text-sm">
            {event.attendingCount ?? attendees.length} attending · capacity{' '}
            {event.capacity}
          </span>
        </Stack>
        <Stack alignCenter gap={8}>
          <ArrowUpRight className="text-muted-foreground" size={14} />
          <span className="text-foreground/80 text-sm">
            Hosted by {host?.name ?? 'Unknown'}
          </span>
        </Stack>
        {topics.length ? (
          <Stack gap wrap>
            {topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </Stack>
        ) : null}
        {attendees.length ? (
          <VStack gap={8}>
            <span className="text-muted-foreground text-xs">
              Community RSVPs
            </span>
            <Stack gap={8} wrap>
              {attendees.slice(0, 4).map(({ node }) => (
                <EventAttendeeChip attendee={node} key={node.id} />
              ))}
            </Stack>
          </VStack>
        ) : null}
        {event.livestreamUrl ? (
          <a
            className="text-primary text-sm font-medium hover:underline"
            href={event.livestreamUrl}
            rel="noreferrer"
            target="_blank"
          >
            Join livestream
          </a>
        ) : null}
      </VStack>
    </Card>
  );
}
