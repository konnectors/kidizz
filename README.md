[Cozy][cozy] Cozy-konnector-kiddiz
=======================================


What is this konnector about ?
------------------------------

This konnector retrieves from https://kidizz.com :
* the photos of your children
* the avatar photo of the class mates of your children


What's Cozy?
------------

![Cozy Logo](https://cdn.rawgit.com/cozy/cozy-guidelines/master/templates/cozy_logo_small.svg)

[Cozy] is a personal data platform that brings all your web services in the same private space. With it, your webapps and your devices can share data easily, providing you with a new experience. You can install Cozy on your own hardware where no one's tracking you.


DEVELOPMENT
------------

### Run and test

Create a `konnector-dev-config.json` file at the root with your test credentials :

```javascript
{
  "COZY_URL": "http://cozy.tools:8080",
  "fields": {"login":"zuck.m@rk.fb", "password":"123456"}
}
```
Then :

```sh
yarn
yarn standalone
```
For running the konnector connected to a Cozy server and more details see [konnectors tutorial](https://docs.cozy.io/en/tutorials/konnector/)

### Open a Pull-Request

If you want to work on this konnector and submit code modifications, feel free to open pull-requests!
</br>See :
* the [contributing guide][contribute] for more information about how to properly open pull-requests.
* the [konnectors development guide](https://docs.cozy.io/en/tutorials/konnector/)

### Plan de tests - 1.0.0
* création from scratch : OK
* re-run : sans modif : OK
* re-run : suppression d'une photo et un avatar sans vidage corbeille : OK
* re-run : sans modif : OK
* re-run : sans modif : OK
* re-run : suppression d'une photo et un avatar avec vidage corbeille : OK
* re-run : sans modif : OK
* re-run : sans modif : OK
* re-run : modification du nom des albums & suppression d'une photo et un avatar & vidage de la corbeille : OK
* test re-run : sans modif : OK
* modification du nom des albums & suppression d'une photo et un avatar & **sans** vidage de la corbeille : OK
* test re-run : sans modif : OK
* modification d'un avatar sur site kidiz : OK
* suppression de l'account data (simule une déconnexion / reconnexion) : ?

### TODO for one day...
- limiter les news que l'on Récupère
- créer un trombi html de la classe de chaque enfant

### Maintainer

The lead maintainers for this konnector is Benibur.

### Get in touch

You can reach the Cozy Community by:

- [Konnectors tutorial](https://docs.cozy.io/en/tutorials/konnector/)
- Chatting with us on IRC [#cozycloud on Libera.Chat][libera]
- Posting on our [Forum]
- Posting issues on the [Github repos][github]
- Say Hi! on [Twitter]


License
-------

https://github.com/konnectors/kidizz is developed by Benibur and distributed under the [AGPL v3 license][agpl-3.0].

[cozy]: https://cozy.io "Cozy Cloud"
[agpl-3.0]: https://www.gnu.org/licenses/agpl-3.0.html
[libera]: https://web.libera.chat/#cozycloud
[forum]: https://forum.cozy.io/
[github]: https://github.com/cozy/
[nodejs]: https://nodejs.org/
[standard]: https://standardjs.com
[twitter]: https://twitter.com/mycozycloud
[webpack]: https://webpack.js.org
[yarn]: https://yarnpkg.com
[travis]: https://travis-ci.org
[contribute]: CONTRIBUTING.md
