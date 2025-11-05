import safeParse from '@nkzw/core/safeParse.js';
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
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
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
};

const UserView = view<User>()({
  id: true,
  name: true,
  username: true,
});

const UserNameForm = ({ user }: { user: SessionUser }) => {
  const [name, setName] = useState(user.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setName(event.target.value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const id = user?.id;
    if (!id) {
      return;
    }

    const newName = name.trim();
    setName(newName);

    if (newName === user.name) {
      setError(null);
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        await fate.mutations.updateUser({
          input: { name: newName },
          optimisticUpdate: { id, username: newName },
          view: UserView,
        });
        await AuthClient.updateUser({ name });
      } catch (error) {
        setError(
          (error instanceof Error &&
            error.message &&
            safeParse<Array<{ message: string }>>(error.message)?.[0]
              ?.message) ||
            'Failed to update user name.',
        );
      }
    });
  };

  const trimmedName = name.trim();
  const originalName = user.name ?? '';
  const isSaveDisabled =
    !user.id || !trimmedName || trimmedName === originalName || isPending;

  return (
    <div>
      <form className="flex items-center gap-2" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="header-username">
          Username
        </label>
        <input
          aria-describedby={error ? 'header-username-error' : undefined}
          aria-invalid={error ? 'true' : undefined}
          className="border-input bg-background text-foreground focus-visible:ring-ring focus-visible:ring-offset-background flex h-8 w-32 rounded-md border px-2 text-sm shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40"
          disabled={isPending}
          id="header-username"
          name="name"
          onChange={handleChange}
          placeholder="Name"
          title={error ?? undefined}
          value={name}
        />
        <Button
          disabled={isSaveDisabled}
          size="sm"
          type="submit"
          variant="secondary"
        >
          Save
        </Button>
      </form>
      {error ? <span id="header-username-error">{error}</span> : null}
    </div>
  );
};

const UserCard = ({ user }: { user: SessionUser | null }) =>
  user ? (
    <Card>
      <VStack gap={4}>
        <H3>Your account</H3>
        <Stack alignCenter between gap={16}>
          <p className="text-muted-foreground text-sm">
            Welcome back{user.name ? `, ${user.name}` : ''}.
          </p>
          <UserNameForm user={user} />
        </Stack>
      </VStack>
    </Card>
  ) : null;

const CommentView = view<Comment>()({
  author: UserView,
  content: true,
  id: true,
});

const Comment = ({ comment: commentRef }: { comment: ViewRef<'Comment'> }) => {
  const comment = useView(CommentView, commentRef);
  const author = useView(UserView, comment.author);

  return (
    <div
      className="group rounded-md border border-gray-200/80 bg-gray-50/70 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
      key={comment.id}
    >
      <Stack between gap={16}>
        <p className="font-medium text-gray-900 dark:text-gray-200">
          {author?.name ?? 'Anonymous'}
        </p>
        <Button
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
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
  author: UserView,
  category: CategorySummaryView,
  comments: {
    items: {
      node: CommentView,
    },
  },
  content: true,
  id: true,
  likes: true,
  tags: {
    items: {
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
  user: SessionUser | null;
}) => {
  const post = useView(PostView, postRef);
  const author = useView(UserView, post.author);
  const category = useView(CategorySummaryView, post.category);
  const comments = post.comments?.items ?? [];
  const tags = post.tags?.items ?? [];

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

  const handleAddComment = async (event: { preventDefault: () => void }) => {
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

  const maybeSubmitComment = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleAddComment(event);
    }
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
              onKeyDown={maybeSubmitComment}
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
  author: UserView,
  id: true,
  likes: true,
  tags: {
    items: {
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
    items: {
      node: CategoryPostView,
    },
  },
});

const CategoryPost = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(CategoryPostView, postRef);
  const author = useView(UserView, post.author);
  const tags = post.tags?.items ?? [];

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
            {tags.map(({ node }) => (
              <TagBadge key={node.id} tag={node} />
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
  const posts = category.posts?.items ?? [];

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
          {posts.map(({ node }) => (
            <CategoryPost key={node.id} post={node} />
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
  author: UserView,
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

const ProjectCard = ({
  project: projectRef,
}: {
  project: ViewRef<'Project'>;
}) => {
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
  user: UserView,
});

const EventView = view<Event>()({
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
    root: RootView,
    type: 'Post',
  },
  projects: {
    args: { first: 3 },
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
