import Stack, { VStack } from '@nkzw/stack';
import { fbs } from 'fbtee';
import { ArrowUpRight, CalendarDays, MapPin, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useView, view, ViewRef } from 'react-fate';
import type { Event, EventAttendee } from '../fate/views.ts';
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
  startAt: true,
  topics: true,
  type: true,
});

const EventAttendeeChip = ({ attendee: attendeeRef }: { attendee: ViewRef<'EventAttendee'> }) => {
  const attendee = useView(EventAttendeeView, attendeeRef);
  const user = useView(UserView, attendee.user);

  return (
    <Badge className="text-nowrap" key={attendee.id} variant="outline">
      {user?.name ?? fbs('Guest', 'Unnamed event attendee')} · {formatLabel(attendee.status)}
    </Badge>
  );
};

const hydrationSafeDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const localDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  month: 'short',
});

const formatDateTime = (date: string, local: boolean) =>
  (local ? localDateTimeFormatter : hydrationSafeDateTimeFormatter).format(new Date(date));

const EventDateTime = ({ endAt, startAt }: { endAt: string; startAt: string }) => {
  const [local, setLocal] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLocal(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {formatDateTime(startAt, local)} → {formatDateTime(endAt, local)}
    </>
  );
};

export default function EventCard({ event: eventRef }: { event: ViewRef<'Event'> }) {
  const event = useView(EventView, eventRef);
  const host = useView(UserView, event.host);
  const attendees = event.attendees?.items ?? [];
  const topics = event.topics ?? [];

  return (
    <Card key={event.id}>
      <VStack gap={12}>
        <Stack alignCenter between gap={12}>
          <div>
            <h4 className="text-base font-semibold text-foreground">{event.name}</h4>
            <p className="text-sm text-muted-foreground">{event.description}</p>
          </div>
          <Badge className="text-nowrap" variant="secondary">
            {formatLabel(event.type)}
          </Badge>
        </Stack>
        <Stack alignCenter gap>
          <CalendarDays className="text-muted-foreground" size={14} />
          <span className="text-sm text-foreground/80">
            <EventDateTime endAt={event.endAt} startAt={event.startAt} />
          </span>
        </Stack>
        <Stack alignCenter gap>
          <MapPin className="text-muted-foreground" size={14} />
          <span className="text-sm text-foreground/80">{event.location}</span>
        </Stack>
        <Stack alignCenter gap>
          <Users className="text-muted-foreground" size={14} />
          <span className="text-sm text-foreground/80">
            <fbt desc="Event attendance and capacity">
              <fbt:param name="attending">{event.attendingCount ?? attendees.length}</fbt:param>{' '}
              attending · capacity <fbt:param name="capacity">{event.capacity}</fbt:param>
            </fbt>
          </span>
        </Stack>
        <Stack alignCenter gap>
          <ArrowUpRight className="text-muted-foreground" size={14} />
          <span className="text-sm text-foreground/80">
            <fbt desc="Event host">
              Hosted by{' '}
              <fbt:param name="host">
                {host?.name ?? fbs('Unknown', 'Unknown event host')}
              </fbt:param>
            </fbt>
          </span>
        </Stack>
        {topics.length ? (
          <Stack gap wrap>
            {topics.map((topic) => (
              <Badge className="text-nowrap" key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </Stack>
        ) : null}
        {attendees.length ? (
          <VStack gap>
            <span className="text-xs text-muted-foreground">
              <fbt desc="EventCard: Community RSVPs">Community RSVPs</fbt>
            </span>
            <Stack gap wrap>
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
            <fbt desc="EventCard: Join livestream">Join livestream</fbt>{' '}
          </a>
        ) : null}
      </VStack>
    </Card>
  );
}
