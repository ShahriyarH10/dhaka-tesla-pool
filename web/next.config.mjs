/** @type {import('next').NextConfig} */
export default {
  output: 'standalone', // small Docker image: only the files the server needs
  reactStrictMode: true,
  poweredByHeader: false,
};
