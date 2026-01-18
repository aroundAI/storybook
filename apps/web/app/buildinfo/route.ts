export const dynamic = 'force-static';

export const GET = () => {
  const info = `
build      : production (OpenNext/SST)
build date : ${process.env.NEXT_PUBLIC_BUILD_DATE}
git branch : ${process.env.NEXT_PUBLIC_BUILD_BRANCH}
release tag: ${process.env.NEXT_PUBLIC_BUILD_RELEASE_TAG}
last commit: ${process.env.NEXT_PUBLIC_BUILD_COMMIT}
by         : ${process.env.NEXT_PUBLIC_BUILD_AUTHOR}

=========================================
=              Cache Info               =
=========================================
None
`.trim();

  return new Response(info, {
    headers: {
      'content-type': 'text/plain',
    },
  });
};
