declare module '*.vue' {
  const component: import('vitepress').Theme['Layout'];
  export default component;
}
