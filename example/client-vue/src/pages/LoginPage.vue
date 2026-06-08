<script setup lang="ts">
import { ExternalLinkIcon } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { visit } from '../router.ts';
import Button from '../ui/Button.vue';
import Card from '../ui/Card.vue';
import H2 from '../ui/H2.vue';
import Input from '../ui/Input.vue';
import Section from '../ui/Section.vue';
import AuthClient from '../user/AuthClient.ts';

const email = ref('');
const password = ref('');
const session = AuthClient.useSession();

const signIn = async () => {
  await AuthClient.signIn.email(
    {
      email: email.value,
      password: password.value,
    },
    {
      onError: () => {},
      onRequest: () => {},
      onSuccess: async () => {
        await session.value.refetch();
        visit('/', { replace: true });
      },
    },
  );
};

onMounted(() => {
  if (session.value.data) {
    visit('/', { replace: true });
  }
});
</script>

<template>
  <Section v-if="!session.data">
    <div class="flex flex-col items-center gap-4">
      <H2 class="pl-5">Sign In</H2>
      <div class="flex flex-wrap gap-8">
        <Card class="w-84">
          <form class="flex flex-col gap-3" @submit.prevent="signIn">
            <Input v-model="email" class="w-48" name="email" placeholder="email" type="email" />
            <Input
              v-model="password"
              class="w-48"
              name="password"
              placeholder="password"
              type="password"
            />
            <div>
              <Button type="submit" variant="outline">Sign In</Button>
            </div>
          </form>
        </Card>
        <Card class="w-84">
          <p>
            Try one of the
            <a
              class="inline-flex items-center gap-1 px-1 underline hover:no-underline"
              href="https://github.com/nkzw-tech/fate/blob/main/example/seedData.ts#L1"
              rel="noreferrer"
              target="_blank"
            >
              Example Accounts
              <ExternalLinkIcon class="h-4 w-4" />
            </a>
            in the seed data.
          </p>
        </Card>
      </div>
    </div>
  </Section>
</template>
