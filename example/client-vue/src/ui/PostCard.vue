<script setup lang="ts">
import type { Comment as InlineComment } from '@nkzw/fate-server/src/trpc/router.ts';
import { computed, ref } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useFateClient, useLiveListView, useLiveView, useView, view } from 'vue-fate';
import {
  CategorySummaryView,
  CommentConnectionView,
  CommentView,
  PostView,
  UserView,
} from '../fateViews.ts';
import AuthClient from '../user/AuthClient.ts';
import Badge from './Badge.vue';
import Button from './Button.vue';
import Card from './Card.vue';
import CommentCard from './CommentCard.vue';
import H3 from './H3.vue';
import Link from './Link.vue';
import TagBadge from './TagBadge.vue';

const props = defineProps<{
  detail?: boolean;
  post: ViewRef<'Post'>;
}>();

const fate = useFateClient();
const session = AuthClient.useSession();
const post = useLiveView(PostView, () => props.post);
const author = useView(UserView, () => post.value?.author ?? null);
const category = useView(CategorySummaryView, () => post.value?.category ?? null);
const [comments, loadNextComments] = useLiveListView(
  CommentConnectionView,
  () => post.value?.comments,
);
const commentText = ref('');
const commentError = ref<unknown>(null);
const commenting = ref(false);
const liking = ref(false);
const unliking = ref(false);
const likeError = ref<unknown>(null);

const tags = computed(() => post.value?.tags?.items ?? []);
const commentingIsDisabled = computed(
  () => commenting.value || commentText.value.trim().length === 0,
);

const like = async (options?: { error?: 'boundary' | 'callSite'; slow?: boolean }) => {
  if (!post.value) {
    return;
  }

  liking.value = true;
  likeError.value = null;
  try {
    await fate.mutations.post.like({
      input: { id: post.value.id, ...options },
      optimistic: { likes: post.value.likes + 1 },
      view: PostView,
    });
  } catch (error) {
    if (options?.error === 'callSite') {
      likeError.value = error;
      window.setTimeout(() => {
        likeError.value = null;
      }, 3000);
    } else {
      throw error;
    }
  } finally {
    liking.value = false;
  }
};

const unlike = async () => {
  if (!post.value) {
    return;
  }

  unliking.value = true;
  try {
    await fate.mutations.post.unlike({
      input: { id: post.value.id },
      optimistic: {
        likes: Math.max(post.value.likes - 1, 0),
      },
      view: PostView,
    });
  } finally {
    unliking.value = false;
  }
};

const addComment = async () => {
  if (!post.value || commentingIsDisabled.value) {
    return;
  }

  const content = commentText.value.trim();
  const user = session.value.data?.user;
  commenting.value = true;
  commentError.value = null;

  try {
    await fate.mutations.comment.add({
      input: { content, postId: post.value.id },
      optimistic: {
        author: user ? { id: user.id, name: user.name } : null,
        content,
        id: `optimistic:${Date.now().toString(36)}`,
        post: { commentCount: post.value.commentCount + 1, id: post.value.id },
      },
      view: view<InlineComment>()({
        ...CommentView,
        post: { commentCount: true },
      }),
    });

    commentText.value = '';
  } catch (error) {
    commentError.value = error;
  } finally {
    commenting.value = false;
  }
};

const maybeSubmitComment = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    void addComment();
  }
};
</script>

<template>
  <Card v-if="post">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-2">
          <Link :to="`/post/${post.id}`">
            <H3>{{ post.title }}</H3>
          </Link>
          <div class="flex flex-wrap items-center gap-2">
            <Link v-if="category" :to="`/category/${category.id}`">
              <Badge
                class="bg-blue-50 text-blue-600 transition hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60"
              >
                {{ category.name }}
              </Badge>
            </Link>
            <div v-if="tags.length" class="flex flex-wrap gap-2">
              <TagBadge v-for="{ node } in tags" :key="node.id" :tag="node" />
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div
            class="squircle flex items-center gap-2 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:bg-neutral-800 dark:text-white"
          >
            <span>👍</span>
            <span>{{ post.likes }} {{ post.likes === 1 ? 'like' : 'likes' }}</span>
          </div>
          <Button :disabled="liking" size="sm" variant="outline" :action="() => like()"
            >Like</Button
          >
          <Button
            v-if="detail"
            :disabled="liking"
            size="sm"
            variant="outline"
            :action="() => like({ slow: true })"
          >
            Like (Slow)
          </Button>
          <Button
            v-if="detail"
            :class="likeError ? 'w-32 border-red-500 text-red-500 hover:text-red-500' : 'w-32'"
            :disabled="liking"
            size="sm"
            variant="outline"
            :action="() => like({ error: 'callSite' })"
          >
            {{ likeError ? 'Oops, try again!' : 'Like (Error)' }}
          </Button>
          <Button
            v-if="detail"
            :disabled="liking"
            size="sm"
            variant="outline"
            :action="() => like({ error: 'boundary' })"
          >
            Like (Network Error)
          </Button>
          <Button
            v-if="detail"
            size="sm"
            variant="outline"
            :action="
              () =>
                fate.mutations.post.like({
                  input: { id: post.id },
                  optimistic: { likes: post.likes + 1 },
                  view: PostView,
                })
            "
          >
            Like (Many)
          </Button>
          <Button
            :disabled="unliking || post.likes === 0"
            size="sm"
            variant="outline"
            :action="unlike"
          >
            Unlike
          </Button>
        </div>
      </div>
      <p class="text-sm leading-relaxed text-foreground/90 lg:text-base">{{ post.content }}</p>
      <p class="text-sm text-muted-foreground">- {{ author?.name ?? 'Unknown author' }}</p>
      <div class="flex flex-col gap-4">
        <h4 class="text-base font-semibold text-foreground">
          {{ post.commentCount }} {{ post.commentCount === 1 ? 'Comment' : 'Comments' }}
        </h4>
        <div v-if="comments.length" class="flex flex-col gap-3">
          <CommentCard
            v-for="{ node } in comments"
            :key="node.id"
            :comment="node"
            :post="{ commentCount: post.commentCount, id: post.id, title: post.title }"
          />
          <Button v-if="loadNextComments" variant="ghost" :action="loadNextComments">
            Load more comments
          </Button>
        </div>
        <form class="flex flex-col gap-4" @submit.prevent="addComment">
          <span class="text-sm font-medium text-foreground">Add a comment</span>
          <textarea
            v-model="commentText"
            class="squircle min-h-20 w-full border border-gray-200/80 bg-gray-100/50 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:placeholder-gray-400"
            :disabled="commenting"
            :placeholder="
              session.data?.user.name
                ? `Share your thoughts, ${session.data.user.name}!`
                : 'Share your thoughts...'
            "
            @keydown="maybeSubmitComment"
          />
          <p v-if="commentError" class="text-sm text-destructive">
            {{
              commentError instanceof Error
                ? commentError.message
                : 'Something went wrong. Please try again.'
            }}
          </p>
          <div class="flex justify-end gap-2">
            <Button :disabled="commentingIsDisabled" size="sm" type="submit" variant="secondary">
              Post comment
            </Button>
          </div>
        </form>
      </div>
    </div>
  </Card>
</template>
