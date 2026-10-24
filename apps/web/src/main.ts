import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import { applyTheme, readTheme } from './appearance';

applyTheme(readTheme());

mount(App, { target: document.getElementById('root')! });
