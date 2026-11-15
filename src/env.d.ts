/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: import('./server/config').User | null;
    channels: import('./server/config').Channel[];
    channel: import('./server/config').Channel | null;
  }
}
