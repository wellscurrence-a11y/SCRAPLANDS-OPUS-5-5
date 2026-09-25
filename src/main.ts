import './ui/base.css';
import './ui/theme.css';
import { bootApp } from './app';

const w = window as any;
const showError = (e: any) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:40px;left:10px;z-index:99;white-space:pre-wrap">${e?.stack ?? e}</pre>`);
};

if (new URLSearchParams(location.search).has('debug') || w.__debug) {
  import('./debug').then((m) => m.bootDebug()).catch(showError);
} else {
  w.__app = bootApp();
}
