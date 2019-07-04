[Cozy][cozy] Cozy-konnector-kiddiz
=======================================

TODO
------------

1. test : importer, supprimer une photo locale : il voit toujours la photo et ne le réimporte pas. ??
2. improve ? : log('debug', myString, thirdArgument) : quid du thirdArgument ?
3. 
2. deduplicate photo before download : pb = getAccoundData ne marche pas en mode dev et en standalone c'est cozyClient.files.statById() qui ne marche pas...
2. créer un album par enfant
3. faire un album par enfant avec les noms et photo des enfants de sa classe ainsi que des encadrants.
4. créer un trombi html de la classe de chaque enfant


What's Cozy?
------------

![Cozy Logo](https://cdn.rawgit.com/cozy/cozy-guidelines/master/templates/cozy_logo_small.svg)

[Cozy] is a personal data platform that brings all your web services in the same private space. With it, your webapps and your devices can share data easily, providing you with a new experience. You can install Cozy on your own hardware where no one's tracking you.

What is this konnector about ?
------------------------------

This konnector retrieves the photos of your children from https://kidizz.com

### Open a Pull-Request

If you want to work on this konnector and submit code modifications, feel free to open pull-requests!
</br>See :
* the [contributing guide][contribute] for more information about how to properly open pull-requests.
* the [konnectors development guide](https://docs.cozy.io/en/tutorials/konnector/)

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

### Cozy-konnector-libs

This connector uses [cozy-konnector-libs](https://github.com/cozy/cozy-konnector-libs). It brings a bunch of helpers to interact with the Cozy server and to fetch data from an online service.

### Maintainer

The lead maintainers for this konnector is Benibur.


### Get in touch

You can reach the Cozy Community by:

- [Konnectors tutorial](https://docs.cozy.io/en/tutorials/konnector/)
- Chatting with us on IRC [#cozycloud on Freenode][freenode]
- Posting on our [Forum]
- Posting issues on the [Github repos][github]
- Say Hi! on [Twitter]


License
-------

<YOUR KONNECTOR NAME> is developed by <your name> and distributed under the [AGPL v3 license][agpl-3.0].

[cozy]: https://cozy.io "Cozy Cloud"
[agpl-3.0]: https://www.gnu.org/licenses/agpl-3.0.html
[freenode]: http://webchat.freenode.net/?randomnick=1&channels=%23cozycloud&uio=d4
[forum]: https://forum.cozy.io/
[github]: https://github.com/cozy/
[nodejs]: https://nodejs.org/
[standard]: https://standardjs.com
[twitter]: https://twitter.com/mycozycloud
[webpack]: https://webpack.js.org
[yarn]: https://yarnpkg.com
[travis]: https://travis-ci.org
[contribute]: CONTRIBUTING.md
