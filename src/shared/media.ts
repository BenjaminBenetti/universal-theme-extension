// Media elements: their pixels are never recolored, and they stay invisible until labeled (they
// would show the site's colors on a crushed page). Shared by the theme CSS and the page-world script.

export const MEDIA_TAGS = ['img', 'video', 'canvas', 'iframe', 'embed', 'object', 'picture', 'image'] as const;
