import { createApp } from "vue";
// import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
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
      groups: [],
      groupOperations: {
        loading: false,
        error: null,
        lastUpdated: null
      },

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
        loaded: false,
        error: null,
      },

      isRecording: false,
      recorder:    null,
      chunks:      [],
      openMenuFor: null,
      transcripts: {},

      volume: 1,
      playbackRate: 1,
      showAudioPopup: false,
      popupAudioUrl: null,
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
            required: ["published"],
            properties: {
              content:   { type: "string" },
              audio:     { type: "string" },
              published: { type: "number" }
            }
          }
        }
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
      const all = this.$graffiti.state || [];
      return all
        .filter(o =>
          o.channels?.includes("designftw") &&
          o.value.activity === "Create" &&
          o.value.object?.type === "Group Chat"
        )
        .sort((a, b) => b.value.published - a.value.published);
    },
  },

  mounted() {
    if (this.$graffitiSession.value) {
      this.refreshGroups();
    }

    this.$graffiti.login({
      oidcIssuer:  'https://broker.pod.inrupt.com/',
      clientName:  'DesignFTW Chat',
      redirectUrl: 'https://lqiao312.github.io/chatplatform/',
      clientId:    '904f6ec7-7f73-48e2-b791-13656a02f8d7',
      usePKCE:     true
    });
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

    handleAudioError(message) {
      message.value.audioError = true;
    },

    async startRecording() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Audio recording not supported in your browser");
        return;
      }
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.chunks = [];
        this.recorder = new MediaRecorder(stream);
        this.recorder.ondataavailable = e => {
          this.chunks.push(e.data);
        };
        this.recorder.start();
        this.isRecording = true;
      } catch (err) {
        alert("Couldn't start recording: " + err.message);
      }
    },

    async stopRecording() {
      return new Promise(resolve => {
        this.recorder.onstop = async () => {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          await this.sendAudioMessage(blob);
          this.isRecording = false;
          resolve();
        };
        this.recorder.stop();
      });
    },

    async sendAudioMessage(blob) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        const session = this.$graffitiSession.value;
        if (!session) return;
      
        await this.$graffiti.put(
          {
            value: { audio: dataUrl, published: Date.now() },
            channels: this.channels
          },
          session
        );
      };
      reader.readAsDataURL(blob);
    },

    toggleMenu(msg) {
      this.openMenuFor = this.openMenuFor === msg ? null : msg;
    },

    downloadMessage(msg) {
      if (!msg.value.audio) return;
      const a = document.createElement('a');
      a.href = msg.value.audio;
      const id = msg.url.split('/').pop() || msg.value.published;
      a.download = `audio-${id}.webm`;
      a.click();
      this.openMenuFor = null;
    },

    async transcriptMessage(m) {
       if (!m.value.audio) return;
       try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: m.value.audio })
        });
        const body = await res.json();
        this.transcripts[m.url] = body.transcript;
      } catch (err) {
        alert('Sorry, could not generate transcript.');
      }
    },

    openAudioPopup(src) {
      this.popupAudioUrl = src;
      this.showAudioPopup = true;
      this.$nextTick(() => {
        const aud = this.$refs.popupAudio;
        if (aud) {
          const safeVolume = Math.max(0, Math.min(1, this.volume));
          const safePlaybackRate = Math.max(0.5, Math.min(2, this.playbackRate));
          
          aud.currentTime = 0;
          aud.volume = safeVolume;
          aud.playbackRate = safePlaybackRate;
          aud.play().catch(() => {});
        }
      });
    },

    closeAudioPopup() {
      const aud = this.$refs.popupAudio;
      if (aud) aud.pause();
      this.showAudioPopup = false;
      this.popupAudioUrl = null;
    },

    changeSpeed() {
      if (this.$refs.popupAudio) {
        const safePlaybackRate = Math.max(0.5, Math.min(2, this.playbackRate));
        this.$refs.popupAudio.playbackRate = safePlaybackRate;
      }
    },

    onLoaded() {
      this.duration = this.$refs.popupAudio.duration;
    },

    handleTransitionEnter(el, done) {
      done();
    },

    handleTransitionLeave(el, done) {
      done();
    },

    formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },

    async createGroupChat(session) {
      try {
        const name = this.newGroupName.trim();
        if (!name) {
          alert("Please enter a group name");
          return;
        }
    
        const newGroup = {
          value: {
            activity: "Create",
            object: { 
              type: "Group Chat", 
              name, 
              channel: crypto.randomUUID() 
            },
            published: Date.now(),
          },
          channels: ["designftw"],
        };
    
        await this.$graffiti.put(newGroup, session);
    
        this.newGroupName = "";
    
        await this.refreshGroups();
    
        this.enterGroup(newGroup);
    
      } catch (error) {
        alert("Failed to create group. Please try again.");
      }
    },

    async refreshGroups() {
      try {
        const response = await this.$graffiti.get({
          channels: ["designftw"],
          schema: this.createSchema
        });
        
        this.groups = response
          .filter(item => item?.value?.activity === "Create")
          .sort((a, b) => b.value.published - a.value.published);
        
      } catch (error) {
        this.groupOperations.error = "Failed to load groups";
      }
    },

    enterGroup(group) {
      const groupObj = group.value ? group.value.object : group;
      this.currentGroup = groupObj.channel;
      this.selectedGroupObject = group;
      this.channels = [groupObj.channel];
      this.editGroupName = groupObj.name;
    },

    formatDate(date) {
      return new Date(date).toLocaleString();
    },

    async setGroupNameOverride(session) {
      try {
        this.groupOperations.loading = true;
        this.groupOperations.error = null;
        
        const name = this.editGroupName.trim();
        if (!name || !this.currentGroup) {
          this.groupOperations.error = "Invalid input";
          return;
        }
    
        const groupIndex = this.groups.findIndex(
          g => g?.value?.object?.channel === this.currentGroup
        );
    
        if (groupIndex === -1) {
          this.groupOperations.error = "Group not found";
          return;
        }
    
        const updatedGroup = {
          ...this.groups[groupIndex],
          value: {
            ...this.groups[groupIndex].value,
            object: {
              ...this.groups[groupIndex].value.object,
              name: name
            }
          }
        };
    
        await this.$graffiti.put(updatedGroup, session);
    
        this.groups[groupIndex] = updatedGroup;
        this.groupNameOverride = null;
        this.editGroupName = "";
    
        await this.refreshGroups();
    
      } catch (error) {
        this.groupOperations.error = "Failed to update group name";
      } finally {
        this.groupOperations.loading = false;
      }
    },

    exitGroup() {
      this.currentGroup = null;
      this.channels = ["designftw"];
    },

    async sendMessage() {
      const text = this.myMessage.trim();
      if (!text) return;

      const session = this.$graffitiSession?.value;
      if (!session) return;
  
      await this.$graffiti.put(
        {
          value: { content: text, published: Date.now() },
          channels: this.channels
        },
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

    async saveProfile() {
      try {
        this.profile.loading = true;
        this.profile.error = null;
        
        const session = this.$graffitiSession?.value;
        if (!session) throw new Error("Not authenticated");
    
        const name = this.profile.name.trim();
        const pronouns = this.profile.pronouns.trim();
    
        if (!name) {
          throw new Error("Name is required");
        }
    
        const profileObj = {
          type: "Profile",
          name: name,
          pronouns: pronouns,
          published: new Date().toISOString()
        };
    
        await this.$graffiti.put({
          value: profileObj,
          channels: [session.actor]
        }, session);
    
        // Hide editor but keep values
        this.showProfileEditor = false;
        
      } catch (error) {
        this.profile.error = error.message;
      } finally {
        this.profile.loading = false;
      }
    },
      
    async loadProfile() {
      try {
        this.profile.loading = true;
        this.profile.error = null;
        
        const session = this.$graffitiSession?.value;
        if (!session) return;
    
        const results = await this.$graffiti.discover({
          channels: [session.actor],
          schema: {
            properties: {
              value: {
                properties: {
                  type: { const: "Profile" }
                }
              }
            }
          }
        });
    
        if (results.length > 0) {
          const latest = results.sort((a, b) => 
            new Date(b.value.published) - new Date(a.value.published)
          )[0];
          
          this.profile.name = latest.value.name || "";
          this.profile.pronouns = latest.value.pronouns || "";
        }
        
      } catch (error) {
        // Silent error - don't show to user during initial load
      } finally {
        this.profile.loading = false;
      }
    },
  },

  watch: {
    "$graffitiSession.value": {
      handler(session) {
        if (session) {
          this.loadProfile();
        } else {
          this.profile = {
            name: "",
            pronouns: "",
            loading: false,
            error: null
          };
        }
      },
      immediate: true
    }
  },
})
.component("username-display", UsernameDisplay)
.use(GraffitiPlugin, {
  graffiti: new GraffitiLocal(),
  // graffiti: new GraffitiRemote(),
})
.mount("#app");