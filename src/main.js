import { h, render } from 'preact';
import { App } from './App.js';

const url = new URL(window.location.href);
const token = url.searchParams.get('api_key')?.trim() || '';
render(h(App, { initialToken: token }), document.getElementById('root'));
