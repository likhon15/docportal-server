# docportal-server


vercel code -

`
{
 "version": 2,
 "builds": [
  {
   "src": "./index.js",
   "use": "@vercel/node"
  }
 ],
 "routes": [
  {
   "src": "/(.*)",
   "dest": "/",
   "methods": [
    "GET",
    "POST",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "PUT"
   ]
  }
 ]
}
`
