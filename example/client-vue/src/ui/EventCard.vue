<script setup lang="ts">
import { ArrowUpRight, CalendarDays, MapPin, Users } from '@lucide/vue';
import { defineComponent, h, type PropType } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { EventAttendeeView, EventView, UserView } from '../fateViews.ts';
import formatLabel from '../lib/formatLabel.ts';
import Badge from './Badge.vue';
import Card from './Card.vue';

const props = defineProps<{
  event: ViewRef<'Event'>;
}>();

const event = useView(EventView, () => props.event);
const host = useView(UserView, () => event.value?.host ?? null);

const intlFormatDateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  month: 'short',
});

const formatDateTime = (date: string) => intlFormatDateTime.format(new Date(date));

const EventAttendeeChip = defineComponent({
  name: 'EventAttendeeChip',
  props: {
    attendee: {
      required: true,
      type: Object as PropType<ViewRef<'EventAttendee'>>,
    },
  },
  setup(props) {
    const attendee = useView(EventAttendeeView, () => props.attendee);
    const user = useView(UserView, () => attendee.value?.user ?? null);

    return () =>
      attendee.value
        ? h(
            Badge,
            { class: 'text-nowrap', variant: 'outline' },
            {
              default: () =>
                `${user.value?.name ?? 'Guest'} · ${formatLabel(attendee.value?.status ?? '')}`,
            },
          )
        : null;
  },
});
</script>

<template>
  <Card v-if="event" :key="event.id">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-foreground">{{ event.name }}</h4>
          <p class="text-sm text-muted-foreground">{{ event.description }}</p>
        </div>
        <Badge class="text-nowrap" variant="secondary">{{ formatLabel(event.type) }}</Badge>
      </div>
      <div class="flex items-center gap-2">
        <CalendarDays class="text-muted-foreground" :size="14" />
        <span class="text-sm text-foreground/80">
          {{ formatDateTime(event.startAt) }} -> {{ formatDateTime(event.endAt) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <MapPin class="text-muted-foreground" :size="14" />
        <span class="text-sm text-foreground/80">{{ event.location }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Users class="text-muted-foreground" :size="14" />
        <span class="text-sm text-foreground/80">
          {{ event.attendingCount ?? event.attendees?.items?.length ?? 0 }} attending · capacity
          {{ event.capacity }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <ArrowUpRight class="text-muted-foreground" :size="14" />
        <span class="text-sm text-foreground/80">Hosted by {{ host?.name ?? 'Unknown' }}</span>
      </div>
      <div v-if="event.topics?.length" class="flex flex-wrap gap-2">
        <Badge v-for="topic in event.topics" :key="topic" class="text-nowrap" variant="outline">
          {{ topic }}
        </Badge>
      </div>
      <div v-if="event.attendees?.items?.length" class="flex flex-col gap-2">
        <span class="text-xs text-muted-foreground">Community RSVPs</span>
        <div class="flex flex-wrap gap-2">
          <EventAttendeeChip
            v-for="{ node } in event.attendees.items.slice(0, 4)"
            :key="node.id"
            :attendee="node"
          />
        </div>
      </div>
      <a
        v-if="event.livestreamUrl"
        class="text-primary text-sm font-medium hover:underline"
        :href="event.livestreamUrl"
        rel="noreferrer"
        target="_blank"
      >
        Join livestream
      </a>
    </div>
  </Card>
</template>
