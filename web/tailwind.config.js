/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#121212",
        panel: "#1a1a1a",
        accent: "#6BFF6B",
        amber: "#FFC857"
      }
    }
  },
  plugins: []
};
