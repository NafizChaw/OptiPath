# 🚀 OptiPath  
A web + mobile route optimization app built with **Vue 3, Vite, and Capacitor**.  
OptiPath helps users plan efficient journeys across multiple destinations with features like:
- Multi-stop optimization  
- Google Places search  
- Options for driving, walking, cycling  
- Export to Google Maps  
- (Planned) gas-stop suggestions, rush-hour prediction, fewer turns, etc.  

---

##  Tech Stack
- [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/) (frontend framework)  
- [TypeScript](https://www.typescriptlang.org/)  
- [Bootstrap 5](https://getbootstrap.com/) (UI styling)  
- [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript) (places & routing)  
- [Capacitor](https://capacitorjs.com/) (native Android/iOS support)  

---

## ⚙️ Prerequisites
Make sure you have installed:
- [Node.js](https://nodejs.org/) (LTS recommended, e.g. 18.x or 20.x)  
- [npm](https://docs.npmjs.com/) (comes with Node.js)  
- [Android Studio](https://developer.android.com/studio) (for Android builds) or Xcode (for iOS)  

---

## 🛠️ Setup Instructions

### 1. Clone the repo
```bash
git clone https://github.com/YourUsername/OptiPath.git
cd OptiPath


2. Install dependencies
npm install

3. Configure environment variables

Create a .env file in the root folder:

VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here


Don’t commit your .env file — it’s already ignored via .gitignore.

Run as Web App (Development)
npm run dev


Open http://localhost:5173
 in your browser.

📱 Run as Mobile App (Android/iOS)
1. Build the web app
npm run build

2. Add Capacitor

(Already included, but if missing:)

npm install @capacitor/core @capacitor/cli
npm install @capacitor/android   # for Android
npm install @capacitor/ios       # for iOS

3. Sync web build into native project
npx cap sync

4. Open in Android Studio / Xcode
npx cap open android   # for Android
npx cap open ios       # for iOS


From there you can run on an emulator or physical device.

📍 Using Native APIs (Optional)

To access device features like GPS:

npm install @capacitor/geolocation


Example in Vue:

import { Geolocation } from '@capacitor/geolocation';

const coords = await Geolocation.getCurrentPosition();
console.log(coords);


This makes "Use Current Location" use the phone’s native GPS instead of just browser GPS.

Workflow (Web + App Development)

Whenever you update code:

Run locally → npm run dev

Test web build → npm run build

Sync to app → npx cap sync

Open/run on device → npx cap open android (or ios)










# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Type Support For `.vue` Imports in TS

Since TypeScript cannot handle type information for `.vue` imports, they are shimmed to be a generic Vue component type by default. In most cases this is fine if you don't really care about component prop types outside of templates. However, if you wish to get actual prop types in `.vue` imports (for example to get props validation when using manual `h(...)` calls), you can enable Volar's Take Over mode by following these steps:

1. Run `Extensions: Show Built-in Extensions` from VS Code's command palette, look for `TypeScript and JavaScript Language Features`, then right click and select `Disable (Workspace)`. By default, Take Over mode will enable itself if the default TypeScript extension is disabled.
2. Reload the VS Code window by running `Developer: Reload Window` from the command palette.

You can learn more about Take Over mode [here](https://github.com/johnsoncodehk/volar/discussions/471).
