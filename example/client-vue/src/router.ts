import { computed, readonly, ref } from 'vue';

const currentPath = ref(window.location.pathname);

window.addEventListener('popstate', () => {
  currentPath.value = window.location.pathname;
});

export const path = readonly(currentPath);

export const visit = (to: string, options: { replace?: boolean } = {}) => {
  if (to === currentPath.value) {
    return;
  }

  if (options.replace) {
    history.replaceState(null, '', to);
  } else {
    history.pushState(null, '', to);
  }
  currentPath.value = window.location.pathname;
  window.scrollTo({ top: 0 });
};

export const goHomeOrBack = () => {
  if (currentPath.value !== '/' && history.state?.idx > 0) {
    history.back();
  } else {
    visit('/', { replace: currentPath.value !== '/' });
  }
};

export const route = computed(() => {
  const postMatch = currentPath.value.match(/^\/post\/([^/]+)$/);
  if (postMatch) {
    return { name: 'post' as const, params: { id: decodeURIComponent(postMatch[1]) } };
  }

  const categoryMatch = currentPath.value.match(/^\/category\/([^/]+)$/);
  if (categoryMatch) {
    return { name: 'category' as const, params: { id: decodeURIComponent(categoryMatch[1]) } };
  }

  if (currentPath.value === '/login') {
    return { name: 'login' as const, params: {} };
  }

  if (currentPath.value === '/search') {
    return { name: 'search' as const, params: {} };
  }

  return { name: 'home' as const, params: {} };
});
