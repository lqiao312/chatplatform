import { createApp } from "vue";
import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";

const UsernameDisplay = {
  props: ["actor"],
  computed: {
    username() {
      try {
        const { pathname } = new URL(this.actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : this.actor;
      } catch {
        const m = this.actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : this.actor;
      }
    },
  },
  template: `<span class="username">@{{ username }}</span>`,
};

createApp({
  data() {
    return {
      newGroupName: "",
      editGroupName: "",
      currentGroup: null,
      selectedGroupObject: null,
      groupNameOverride: null,
      channels: ["designftw"],

      myMessage: "",
      editingMessage: null,
      editedContent: "",

      showProfileEditor: false,
      profile: {
        name: "",
        pronouns: "",
        describes: "",
      },
    };
  },

  computed: {
    createSchema() {
      return {
        properties: {
          value: {
            required: ["activity", "object", "published"],
            properties: {
              activity: { const: "Create" },
              object: {
                required: ["type", "name", "channel"],
                properties: {
                  type: { const: "Group Chat" },
                  name: { type: "string" },
                  channel: { type: "string" },
                },
              },
              published: { type: "number" }
            },
          },
        },
      };
    },

    msgSchema() {
      return {
        properties: {
          value: {
            required: ["activity", "object", "published"],
            properties: {
              content: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      };
    },

    username() {
      const actor = this.$graffitiSession?.value?.actor ?? "";
      try {
        const { pathname } = new URL(actor);
        const segments = pathname.split("/").filter(Boolean);
        return segments.length ? segments.at(-1) : actor;
      } catch {
        const m = actor.match(/([^/:#]+)(?=[#\/]*$)/);
        return m ? m[1] : actor;
      }
    },

    groupName() {
      if (this.groupNameOverride) return this.groupNameOverride.name;
      return this.selectedGroupObject?.value?.object?.name ?? "Unnamed Group";
    },

    sortedGroups() {
      return this.$graffiti.state
        .filter(o =>
          o.channels?.includes("designftw") &&
          o.value?.activity === "Create" &&
          o.value?.object?.type === "Group Chat"
        )
        .slice()
        .sort((a, b) => b.value.published - a.value.published);
    },
  },

  methods: {
    startLogin() {
      const redirect = window.location.origin + window.location.pathname;
      this.$graffiti.login({
        oidcIssuer:  'https://broker.pod.inrupt.com/',
        clientName:  'DesignFTW Chat',
        redirectUrl: redirect
      });
    },

    async createGroupChat(session) {
      const name = this.newGroupName.trim();
      if (!name) return;

      await this.$graffiti.put(
        {
          value: {
            activity: "Create",
            object: { type: "Group Chat", name, channel: crypto.randomUUID() },
            published: Date.now(),
          },
          channels: ["designftw"],
        },
        session
      );
      this.newGroupName = "";
    },

    enterGroup(group) {
      this.currentGroup = group.value.object.channel;
      this.selectedGroupObject = group;
      this.channels = [group.value.object.channel];

      const override = this.$graffiti?.state?.find(
        (o) => o.value?.name && o.value?.describes === group.value.object.channel
      );
      this.groupNameOverride = override?.value ?? null;
    },

    async setGroupNameOverride(session) {
      const name = this.editGroupName.trim();
      if (!name || !this.currentGroup) return;
    
      const createObj = this.$graffiti.state.find(
        o =>
          o.value?.activity === "Create" &&
          o.value?.object?.channel === this.currentGroup
      );
    
      if (createObj) {
        await this.$graffiti.patch(
          { value: [{ op: "replace", path: "/object/name", value: name }] },
          createObj,
          session
        );
        createObj.value.object.name = name;
      }
    
      await this.$graffiti.put(
        { value: { name, describes: this.currentGroup }, channels: [this.currentGroup] },
        session
      );
    
      this.groupNameOverride = { name };
    
      this.editGroupName = "";
    },    

    exitGroup() {
      this.currentGroup = null;
      this.channels = ["designftw"];
    },

    async sendMessage(session) {
      const text = this.myMessage.trim();
      if (!text) return;
      await this.$graffiti.put(
        { value: { content: text, published: Date.now() }, channels: this.channels },
        session
      );
      this.myMessage = "";
    },

    async deleteMessage(message, session) {
      await this.$graffiti.delete(message, session);
    },

    async editMessage(message, newContent, session) {
      const content = newContent.trim();
      if (!content) return;
      await this.$graffiti.patch(
        { value: [{ op: "replace", path: "/content", value: content }] },
        message,
        session
      );
      this.editingMessage = null;
      this.editedContent = "";
    },

    async saveProfile() {
      const session = this.$graffitiSession?.value;
      if (!session) return;

      const profile = {
        name: this.profile.name,
        pronouns: this.profile.pronouns,
        describes: this.profile.describes || session.actor,
        published: Date.now(),
      };

      await this.$graffiti.put({ value: profile, channels: [session.actor] }, session);
      await this.loadProfile();
      this.showProfileEditor = false;
    },

    scrollToProfile() {
      const section = document.getElementById("profile-editor");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },

    openProfile() {
        this.showProfileEditor = true;
        this.$nextTick(() => {
        this.scrollToProfile();
      });
    },

    async loadProfile() {
      const session = this.$graffitiSession?.value;
      if (!session) return;
    
      const req = {
        channels: [ session.actor ],
        schema: {
          properties: {
            value: {
              required: ["name","published"],
              properties: {
                name:      { type: "string" },
                pronouns:  { type: "string" },
                describes: { type: "string" },
                published: { type: "number" },
              },
            },
          },
        },
      };
    
      const profiles = await this.$graffiti.discover(req, session);
    
      const latest = profiles
        .sort((a, b) => b.value.published - a.value.published)[0];
      if (latest) {
        this.profile = {
          name:      latest.value.name      || "",
          pronouns:  latest.value.pronouns  || "",
          describes: latest.value.describes || ""
        };
      }
    },
  },

  watch: {
    "$graffitiSession.value": {
      handler(s) { if (s) this.loadProfile(); },
      immediate: true,
    },
  },
})
.component("username-display", UsernameDisplay)
.use(GraffitiPlugin, { graffiti: new GraffitiRemote({url: "https://chatplatform-base.vercel.app"}) })
.mount("#app");
