# Chrome Web Store images

Everything the store listing asks for, all 24-bit PNG without alpha:

| File | Where it goes in the developer dashboard |
| --- | --- |
| `screenshot-1-pick-a-theme.png` … `screenshot-5-make-your-own.png` | Store listing → Screenshots, in this order (1280×800) |
| `promo-small-440x280.png` | Store listing → Small promo tile (440×280) |

The 128×128 store icon is Inky, already inside the extension zip from the latest
[release](https://github.com/BenjaminBenetti/universal-theme-extension/releases/latest).

To make them again (after `npm run video:capture`, which takes the page captures):

```sh
npm run store:images
```

The screenshots are composed from the video's captures: real pages, themed by the real extension
and Jev. The only additions are the popup laid over shot 1 and the name labels on shots 2 and 3.
