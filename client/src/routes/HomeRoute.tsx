import Stack, { VStack } from '@nkzw/stack';
import { useRequest, ViewRef } from 'react-fate';
import CategoryCard, { CategoryView } from '../ui/CategoryCard.tsx';
import EventCard, { EventView } from '../ui/EventCard.tsx';
import H3 from '../ui/H3.tsx';
import { PostCard, PostView } from '../ui/PostCard.tsx';
import ProjectCard, { ProjectView } from '../ui/ProjectCard.tsx';
import Section from '../ui/Section.tsx';
import UserCard from '../ui/UserCard.tsx';
import AuthClient from '../user/AuthClient.tsx';

const PostFeed = ({ posts }: { posts: Array<ViewRef<'Post'>> }) => (
  <VStack gap={16}>
    {posts.map((post) => (
      <PostCard key={post.id} post={post} />
    ))}
  </VStack>
);

const CategoryFeed = ({
  categories,
}: {
  categories: Array<ViewRef<'Category'>>;
}) =>
  categories.length ? (
    <VStack gap={16}>
      <H3>Explore by theme</H3>
      {categories.map((category) => (
        <CategoryCard category={category} key={category.id} />
      ))}
    </VStack>
  ) : null;

const ProjectFeed = ({ projects }: { projects: Array<ViewRef<'Project'>> }) =>
  projects.length ? (
    <VStack gap={16}>
      <H3>Project spotlight</H3>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </VStack>
  ) : null;

const EventFeed = ({ events }: { events: Array<ViewRef<'Event'>> }) =>
  events.length ? (
    <VStack gap={16}>
      <H3>Events</H3>
      {events.map((event) => (
        <EventCard event={event} key={event.id} />
      ))}
    </VStack>
  ) : null;

const request = {
  categories: {
    args: { first: 4 },
    root: CategoryView,
    type: 'Category',
  },
  events: {
    args: { first: 3 },
    root: EventView,
    type: 'Event',
  },
  posts: {
    args: { first: 20 },
    root: PostView,
    type: 'Post',
  },
  projects: {
    args: { first: 3 },
    root: ProjectView,
    type: 'Project',
  },
} as const;

export default function HomeRoute() {
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const { categories, events, posts, projects } = useRequest(request);

  return (
    <Section>
      <VStack gap={24}>
        <UserCard user={user ?? null} />
        <Stack gap={24}>
          <VStack gap={16}>
            <H3>Latest posts</H3>
            <PostFeed posts={posts} />
          </VStack>
          <VStack className="w-2/5" gap={16}>
            <CategoryFeed categories={categories} />
            <ProjectFeed projects={projects} />
            <EventFeed events={events} />
          </VStack>
        </Stack>
      </VStack>
    </Section>
  );
}
