import DefaultTheme from 'vitepress/theme';
import './docs.css';

const listener = (event: DragEvent) => {
  const target = event.target;
  if (target && 'tagName' in target && target.tagName === 'A') {
    event.preventDefault();
  }
};

if (typeof document !== 'undefined') {
  document.addEventListener('dragstart', listener);
}

export default {
  ...DefaultTheme,
};
