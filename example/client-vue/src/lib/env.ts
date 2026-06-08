import defineEnv from '@nkzw/define-env';

export default defineEnv(['SERVER_URL'], {
  SERVER_URL: import.meta.env.VITE_SERVER_URL,
});
