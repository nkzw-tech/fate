import Stack, { VStack } from '@nkzw/stack';
import {
  ArrowUpRight,
  CalendarDays,
  MapPin,
  Target,
  Users,
  X,
} from 'lucide-react';
import {
  FormEvent,
  Suspense,
  useCallback,
  useState,
  useTransition,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useRequest, useView, view, ViewRef } from 'react-fate';
import type {
  Category,
  Comment,
  Event,
  EventAttendee,
  Post,
  Project,
  ProjectUpdate,
  Tag,
  User,
} from '../lib/fate.tsx';
import { fate } from '../lib/fate.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import H3 from '../ui/H3.tsx';
import Section from '../ui/Section.tsx';
import AuthClient from '../user/AuthClient.tsx';

type SessionUser = {
  id?: string | null;
  name?: string | null;
  username?: string | null;
} | null;

const UserCard = ({ user }: { user: SessionUser }) => {
  if (!user) {
    return null;
  }

  return (
    <Card>
      <VStack gap={4}>
        <H3>Your account</H3>
        <p className="text-muted-foreground text-sm">
          Welcome back{user.name ? `, ${user.name}` : ''}.
        </p>
      </VStack>
    </Card>
  );
};

const AuthorView = view<User>()({
  id: true,
  name: true,
});

const CommentView = view<Comment>()({
  author: AuthorView,
  content: true,
  id: true,
});

const Comment = ({ comment: commentRef }: { comment: ViewRef<'Comment'> }) => {
  const comment = useView(CommentView, commentRef);
  const author = useView(AuthorView, comment.author);

  return (
    <div
      className="rounded-md border border-gray-200/80 bg-gray-50/70 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
      key={comment.id}
    >
      <Stack between gap={16}>
        <p className="font-medium text-gray-900 dark:text-gray-200">
          {author?.name ?? 'Anonymous'}
        </p>
        <Button
          onClick={async () => {
            await fate.mutations.deleteComment({
              input: { id: comment.id },
              view: 'deleteRecord',
            });
          }}
          size="sm"
          variant="ghost"
        >
          <X size={14} />
        </Button>
      </Stack>
      <p className="text-foreground/80">{comment.content}</p>
    </div>
  );
};

const TagView = view<Tag>()({
  description: true,
  id: true,
  name: true,
});

const CategorySummaryView = view<Category>()({
  id: true,
  name: true,
});

const PostView = view<Post>()({
  author: AuthorView,
  category: CategorySummaryView,
  comments: {
    edges: {
      node: CommentView,
    },
  },
  content: true,
  id: true,
  likes: true,
  tags: {
    edges: {
      node: TagView,
    },
  },
  title: true,
});

const Post = ({
  post: postRef,
  user,
}: {
  post: ViewRef<'Post'>;
  user: SessionUser;
}) => {
  const post = useView(PostView, postRef);
  const author = useView(AuthorView, post.author);
  const category = useView(CategorySummaryView, post.category);
  const comments = post.comments?.edges ?? [];
  const tags = post.tags?.edges ?? [];

  const [commentText, setCommentText] = useState('');

  const [likeIsPending, startLikeTransition] = useTransition();
  const [unlikeIsPending, startUnlikeTransition] = useTransition();
  const [addCommentIsPending, startAddCommentTransition] = useTransition();
  const [addCommentError, setAddCommentError] = useState<unknown>(null);

  const handleLike = useCallback(async () => {
    startLikeTransition(async () => {
      await fate.mutations.likePost({
        input: { id: post.id },
        optimisticUpdate: { likes: post.likes + 1 },
        view: PostView,
      });
    });
  }, [post.id, post.likes]);

  const handleUnlike = useCallback(async () => {
    startUnlikeTransition(async () => {
      await fate.mutations.unlikePost({
        input: { id: post.id },
        optimisticUpdate: {
          likes: Math.max(post.likes - 1, 0),
        },
        view: PostView,
      });
    });
  }, [post.id, post.likes]);

  const handleAddComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = commentText.trim();

    if (!content) {
      return;
    }

    setAddCommentError(null);
    startAddCommentTransition(async () => {
      try {
        await fate.mutations.addComment({
          input: { content, postId: post.id },
          view: CommentView,
        });
      } catch (error) {
        setAddCommentError(error);
        return;
      }

      setCommentText('');
    });
  };

  const isCommentDisabled =
    addCommentIsPending || commentText.trim().length === 0;

  return (
    <Card>
      <VStack gap={16}>
        <Stack between gap={16}>
          <div>
            <h3 className="text-foreground text-lg font-semibold">
              {post.title}
            </h3>
            <Stack alignCenter gap={8} wrap>
              {category ? (
                <span className="text-muted-foreground text-sm">
                  {category.name}
                </span>
              ) : null}
              {tags.length ? (
                <Stack gap wrap>
                  {tags.map((edge) => (
                    <TagBadge key={edge.node.id} tag={edge.node} />
                  ))}
                </Stack>
              ) : null}
            </Stack>
            <p className="text-muted-foreground text-sm">
              by {author?.name ?? 'Unknown author'} · {comments.length}{' '}
              {comments.length === 1 ? 'comment' : 'comments'}
            </p>
          </div>
          <Stack alignCenter gap>
            <Button
              disabled={likeIsPending}
              onClick={handleLike}
              size="sm"
              variant="outline"
            >
              Like
            </Button>
            <Button
              disabled={unlikeIsPending || post.likes === 0}
              onClick={handleUnlike}
              size="sm"
              variant="outline"
            >
              Unlike
            </Button>
          </Stack>
        </Stack>

        <p className="text-foreground/90 text-sm leading-relaxed">
          {post.content}
        </p>

        <Stack alignCenter className="text-sm font-medium" gap={12} wrap>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-900 dark:bg-gray-950 dark:text-gray-200">
            {post.likes} {post.likes === 1 ? 'like' : 'likes'}
          </span>
        </Stack>
        <VStack gap={16}>
          <h4 className="text-foreground text-base font-semibold">Comments</h4>
          {comments.length > 0 ? (
            <VStack gap={12}>
              {comments.map((edge) => (
                <Comment comment={edge.node} key={edge.node.id} />
              ))}
            </VStack>
          ) : null}
          <VStack as="form" gap onSubmit={handleAddComment}>
            <label
              className="text-foreground text-sm font-medium"
              htmlFor={`comment-${post.id}`}
            >
              Add a comment
            </label>
            <textarea
              className="bg-background text-foreground min-h-20 w-full rounded-md border border-gray-200 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-neutral-800 dark:focus:border-gray-400 dark:focus:ring-gray-900"
              id={`comment-${post.id}`}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder={
                user?.name
                  ? `Share your thoughts, ${user.name}!`
                  : 'Share your thoughts...'
              }
              value={commentText}
            />
            {addCommentError ? (
              <p className="text-destructive text-sm">
                {addCommentError instanceof Error
                  ? addCommentError.message
                  : 'Something went wrong. Please try again.'}
              </p>
            ) : null}
            <Stack end gap>
              <Button
                disabled={isCommentDisabled}
                size="sm"
                type="submit"
                variant="secondary"
              >
                Post comment
              </Button>
            </Stack>
          </VStack>
        </VStack>
      </VStack>
    </Card>
  );
};

const PostFeed = ({
  posts,
  user,
}: {
  posts: Array<ViewRef<'Post'>>;
  user: SessionUser | null;
}) => (
  <VStack gap={16}>
    {posts.map((post) => (
      <Post key={post.id} post={post} user={user} />
    ))}
  </VStack>
);

const RootView = view<Post>()({
  ...PostView,
});

const TagBadge = ({ tag: tagRef }: { tag: ViewRef<'Tag'> }) => {
  const tag = useView(TagView, tagRef);

  if (!tag) {
    return null;
  }

  return (
    <Badge
      className="bg-secondary/70 text-secondary-foreground"
      variant="secondary"
    >
      #{tag.name}
    </Badge>
  );
};

const CategoryPostView = view<Post>()({
  author: AuthorView,
  id: true,
  likes: true,
  tags: {
    edges: {
      node: TagView,
    },
  },
  title: true,
});

const CategoryView = view<Category>()({
  description: true,
  id: true,
  name: true,
  postCount: true,
  posts: {
    edges: {
      node: CategoryPostView,
    },
  },
});

const CategoryPost = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(CategoryPostView, postRef);
  const author = useView(AuthorView, post.author);
  const tags = post.tags?.edges ?? [];

  return (
    <VStack gap key={post.id}>
      <Stack alignCenter between gap={12}>
        <span className="text-foreground font-medium">{post.title}</span>
        <span className="text-muted-foreground text-xs">
          {post.likes} likes
        </span>
      </Stack>
      <Stack alignCenter gap={8} wrap>
        <span className="text-muted-foreground text-xs">
          {author?.name ? `by ${author.name}` : 'By an anonymous collaborator'}
        </span>
        {tags.length ? (
          <Stack gap wrap>
            {tags.map((edge) => (
              <TagBadge key={edge.node.id} tag={edge.node} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </VStack>
  );
};

const CategoryCard = ({
  category: categoryRef,
}: {
  category: ViewRef<'Category'>;
}) => {
  const category = useView(CategoryView, categoryRef);
  const posts = category.posts?.edges ?? [];

  return (
    <Card key={category.id}>
      <VStack gap={12}>
        <Stack alignCenter between gap={12}>
          <div>
            <h4 className="text-foreground text-base font-semibold">
              {category.name}
            </h4>
            <p className="text-muted-foreground text-sm">
              {category.description}
            </p>
          </div>
          <Badge className="text-nowrap" variant="outline">
            {category.postCount} posts
          </Badge>
        </Stack>
        <VStack gap={12}>
          {posts.map((edge) => (
            <CategoryPost key={edge.node.id} post={edge.node} />
          ))}
        </VStack>
      </VStack>
    </Card>
  );
};

const CategoryShowcase = ({
  categories,
}: {
  categories: Array<ViewRef<'Category'>>;
}) => {
  if (!categories.length) {
    return null;
  }

  return (
    <VStack gap={16}>
      <H3>Explore by theme</H3>
      <VStack gap={16}>
        {categories.map((category) => (
          <CategoryCard category={category} key={category.id} />
        ))}
      </VStack>
    </VStack>
  );
};

const ProjectUpdateView = view<ProjectUpdate>()({
  author: AuthorView,
  confidence: true,
  content: true,
  createdAt: true,
  id: true,
  mood: true,
});

const ProjectView = view<Project>()({
  focusAreas: true,
  id: true,
  metrics: true,
  name: true,
  owner: AuthorView,
  progress: true,
  startDate: true,
  status: true,
  summary: true,
  targetDate: true,
  updates: {
    edges: {
      node: ProjectUpdateView,
    },
  },
});

const formatLabel = (value: string) =>
  value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const ProjectUpdateItem = ({
  update: updateRef,
}: {
  update: ViewRef<'ProjectUpdate'>;
}) => {
  const update = useView(ProjectUpdateView, updateRef);
  const author = useView(AuthorView, update.author);

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

const ProjectCard = ({
  project: projectRef,
}: {
  project: ViewRef<'Project'>;
}) => {
  const project = useView(ProjectView, projectRef);
  const owner = useView(AuthorView, project.owner);
  const updates = project.updates?.edges ?? [];
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
              {updates.map((edge) => (
                <ProjectUpdateItem key={edge.node.id} update={edge.node} />
              ))}
            </VStack>
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
};

const ProjectSpotlight = ({
  projects,
}: {
  projects: Array<ViewRef<'Project'>>;
}) => {
  if (!projects.length) {
    return null;
  }

  return (
    <VStack gap={16}>
      <H3>Project spotlight</H3>
      <VStack gap={16}>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </VStack>
    </VStack>
  );
};

const EventAttendeeView = view<EventAttendee>()({
  id: true,
  notes: true,
  status: true,
  user: AuthorView,
});

const EventView = view<Event>()({
  attendees: {
    edges: {
      node: EventAttendeeView,
    },
  },
  attendingCount: true,
  capacity: true,
  description: true,
  endAt: true,
  host: AuthorView,
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
  const user = useView(AuthorView, attendee.user);

  return (
    <Badge key={attendee.id} variant="outline">
      {user?.name ?? 'Guest'} · {formatLabel(attendee.status)}
    </Badge>
  );
};

const intlFormatDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const intlFormatDateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  month: 'short',
});

const formatDate = (value: string | null | undefined) =>
  value ? intlFormatDate.format(new Date(value)) : 'TBD';

const formatDateTime = (date: string) =>
  intlFormatDateTime.format(new Date(date));

const EventCard = ({ event: eventRef }: { event: ViewRef<'Event'> }) => {
  const event = useView(EventView, eventRef);
  const host = useView(AuthorView, event.host);
  const attendees = event.attendees?.edges ?? [];
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
              {attendees.slice(0, 4).map((edge) => (
                <EventAttendeeChip attendee={edge.node} key={edge.node.id} />
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
};

const Events = ({ events }: { events: Array<ViewRef<'Event'>> }) => {
  if (!events.length) {
    return null;
  }

  return (
    <VStack gap={16}>
      <H3>Events</H3>
      <VStack gap={16}>
        {events.map((event) => (
          <EventCard event={event} key={event.id} />
        ))}
      </VStack>
    </VStack>
  );
};

const request = {
  categories: {
    args: { take: 4 },
    root: CategoryView,
    type: 'Category',
  },
  events: {
    args: { limit: 3 },
    root: EventView,
    type: 'Event',
  },
  posts: {
    args: { first: 20 },
    root: RootView,
    type: 'Post',
  },
  projects: {
    args: { take: 3 },
    root: ProjectView,
    type: 'Project',
  },
} as const;

const Home = () => {
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const { categories, events, posts, projects } = useRequest(request);

  return (
    <VStack gap={24}>
      <UserCard user={user ?? null} />
      <Stack gap={24}>
        <VStack gap={16}>
          <H3>Latest posts</H3>
          <PostFeed posts={posts} user={user ?? null} />
        </VStack>
        <VStack className="w-2/5" gap={16}>
          <CategoryShowcase categories={categories} />
          <ProjectSpotlight projects={projects} />
          <Events events={events} />
        </VStack>
      </Stack>
    </VStack>
  );
};

export default function HomeRoute() {
  return (
    <Section>
      <ErrorBoundary
        fallbackRender={({ error }) => (
          <Card>
            <h3 className="text-xl font-semibold text-red-700">Error</h3>
            <code>{error.stack || `Fate Error: ${error.message}`}</code>
          </Card>
        )}
      >
        <Suspense
          fallback={
            <Stack center className="text-gray-500 italic" verticalPadding={48}>
              Thinking...
            </Stack>
          }
        >
          <Home />
        </Suspense>
      </ErrorBoundary>
    </Section>
  );
}
